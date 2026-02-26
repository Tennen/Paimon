package main

import (
	"bytes"
	"crypto/aes"
	"crypto/cipher"
	"crypto/sha1"
	"encoding/base64"
	"encoding/binary"
	"encoding/json"
	"encoding/xml"
	"errors"
	"fmt"
	"io"
	"log"
	"mime/multipart"
	"net/http"
	"net/url"
	"os"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
)

type bridgeConfig struct {
	Port             int
	WeComToken       string
	WeComAESKey      string
	WeComReceiveID   string
	BridgeToken      string
	MessageBufferCap int
}

type sseEvent struct {
	ID      int64
	Payload []byte
}

type sseClient struct {
	ch chan sseEvent
}

type bridgeState struct {
	mu          sync.Mutex
	nextEventID int64
	buffer      []sseEvent
	bufferCap   int
	clients     map[*sseClient]struct{}
}

type wecomXML struct {
	XMLName      xml.Name `xml:"xml"`
	MsgType      string   `xml:"MsgType"`
	Content      string   `xml:"Content"`
	FromUserName string   `xml:"FromUserName"`
	ToUserName   string   `xml:"ToUserName"`
	MsgId        string   `xml:"MsgId"`
	MsgID        string   `xml:"MsgID"`
	MediaId      string   `xml:"MediaId"`
	PicUrl       string   `xml:"PicUrl"`
	Encrypt      string   `xml:"Encrypt"`
}

type wecomMessage struct {
	MsgType  string
	Content  string
	FromUser string
	ToUser   string
	MsgID    string
	MediaID  string
	PicURL   string
}

const (
	defaultPort             = 8080
	defaultBufferSize       = 200
	maxBodyBytes      int64 = 10 * 1024 * 1024
)

func main() {
	cfg := loadConfig()
	state := &bridgeState{
		nextEventID: 1,
		bufferCap:   cfg.MessageBufferCap,
		clients:     make(map[*sseClient]struct{}),
	}

	mux := http.NewServeMux()
	mux.HandleFunc("/health", handleHealth)
	mux.HandleFunc("/stream", func(w http.ResponseWriter, r *http.Request) {
		handleStream(w, r, cfg, state)
	})
	mux.HandleFunc("/wecom", func(w http.ResponseWriter, r *http.Request) {
		handleWeCom(w, r, cfg, state)
	})
	mux.HandleFunc("/proxy/gettoken", func(w http.ResponseWriter, r *http.Request) {
		handleProxyGetToken(w, r, cfg)
	})
	mux.HandleFunc("/proxy/send", func(w http.ResponseWriter, r *http.Request) {
		handleProxySend(w, r, cfg)
	})
	mux.HandleFunc("/proxy/media/upload", func(w http.ResponseWriter, r *http.Request) {
		handleProxyUpload(w, r, cfg)
	})
	mux.HandleFunc("/proxy/media/get", func(w http.ResponseWriter, r *http.Request) {
		handleProxyMediaGet(w, r, cfg)
	})

	addr := fmt.Sprintf(":%d", cfg.Port)
	server := &http.Server{
		Addr:              addr,
		Handler:           loggingMiddleware(mux),
		ReadHeaderTimeout: 10 * time.Second,
	}

	log.Printf("wecom-bridge listening on %s", addr)
	if err := server.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
		log.Fatalf("server error: %v", err)
	}
}

func loadConfig() bridgeConfig {
	port := getenvInt("PORT", defaultPort)
	bufferCap := getenvInt("BRIDGE_BUFFER_SIZE", defaultBufferSize)
	if bufferCap <= 0 {
		bufferCap = defaultBufferSize
	}
	return bridgeConfig{
		Port:             port,
		WeComToken:       strings.TrimSpace(os.Getenv("WECOM_TOKEN")),
		WeComAESKey:      strings.TrimSpace(os.Getenv("WECOM_AES_KEY")),
		WeComReceiveID:   strings.TrimSpace(os.Getenv("WECOM_RECEIVE_ID")),
		BridgeToken:      strings.TrimSpace(os.Getenv("WECOM_BRIDGE_TOKEN")),
		MessageBufferCap: bufferCap,
	}
}

func getenvInt(key string, fallback int) int {
	if v := strings.TrimSpace(os.Getenv(key)); v != "" {
		if n, err := strconv.Atoi(v); err == nil {
			return n
		}
	}
	return fallback
}

func loggingMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/health" {
			next.ServeHTTP(w, r)
			return
		}
		start := time.Now()
		next.ServeHTTP(w, r)
		log.Printf("%s %s %s", r.Method, r.URL.Path, time.Since(start).Round(time.Millisecond))
	})
}

func handleHealth(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	_, _ = w.Write([]byte(`{"ok":true}`))
}

func handleStream(w http.ResponseWriter, r *http.Request, cfg bridgeConfig, state *bridgeState) {
	if r.Method != http.MethodGet {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}
	if cfg.BridgeToken != "" {
		if r.Header.Get("Authorization") != fmt.Sprintf("Bearer %s", cfg.BridgeToken) {
			w.WriteHeader(http.StatusUnauthorized)
			_, _ = w.Write([]byte("unauthorized"))
			return
		}
	}
	flusher, ok := w.(http.Flusher)
	if !ok {
		w.WriteHeader(http.StatusInternalServerError)
		_, _ = w.Write([]byte("stream unsupported"))
		return
	}
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	_, _ = w.Write([]byte("\n"))
	flusher.Flush()

	lastEventID := parseLastEventID(r)
	if lastEventID > 0 {
		missed := state.getMissed(lastEventID)
		for _, ev := range missed {
			if err := writeSSE(w, ev); err != nil {
				return
			}
			flusher.Flush()
		}
		log.Printf("wecom stream replay %d messages since %d", len(missed), lastEventID)
	}

	client := &sseClient{ch: make(chan sseEvent, 16)}
	state.addClient(client)
	defer state.removeClient(client)

	ctx := r.Context()
	for {
		select {
		case <-ctx.Done():
			return
		case ev := <-client.ch:
			if err := writeSSE(w, ev); err != nil {
				return
			}
			flusher.Flush()
		}
	}
}

func parseLastEventID(r *http.Request) int64 {
	if v := strings.TrimSpace(r.Header.Get("Last-Event-ID")); v != "" {
		if id, err := strconv.ParseInt(v, 10, 64); err == nil {
			return id
		}
	}
	if v := strings.TrimSpace(r.URL.Query().Get("lastEventId")); v != "" {
		if id, err := strconv.ParseInt(v, 10, 64); err == nil {
			return id
		}
	}
	return 0
}

func writeSSE(w io.Writer, ev sseEvent) error {
	if _, err := fmt.Fprintf(w, "id: %d\n", ev.ID); err != nil {
		return err
	}
	if _, err := fmt.Fprintf(w, "event: message\n"); err != nil {
		return err
	}
	if _, err := fmt.Fprintf(w, "data: %s\n\n", ev.Payload); err != nil {
		return err
	}
	return nil
}

func handleWeCom(w http.ResponseWriter, r *http.Request, cfg bridgeConfig, state *bridgeState) {
	switch r.Method {
	case http.MethodGet:
		handleWeComVerify(w, r, cfg)
	case http.MethodPost:
		handleWeComPost(w, r, cfg, state)
	default:
		w.WriteHeader(http.StatusMethodNotAllowed)
	}
}

func handleWeComVerify(w http.ResponseWriter, r *http.Request, cfg bridgeConfig) {
	q := r.URL.Query()
	signature := firstNonEmpty(q.Get("msg_signature"), q.Get("signature"))
	timestamp := q.Get("timestamp")
	nonce := q.Get("nonce")
	echostr := q.Get("echostr")

	if cfg.WeComToken == "" || cfg.WeComAESKey == "" {
		w.WriteHeader(http.StatusInternalServerError)
		_, _ = w.Write([]byte("missing token or aes key"))
		return
	}
	if echostr == "" {
		w.WriteHeader(http.StatusBadRequest)
		_, _ = w.Write([]byte("missing echostr"))
		return
	}

	expected := sha1Hex(sortedJoin([]string{cfg.WeComToken, timestamp, nonce, echostr}))
	if signature == "" || signature != expected {
		w.WriteHeader(http.StatusUnauthorized)
		_, _ = w.Write([]byte("invalid signature"))
		return
	}

	plain, ok := decryptWeCom(echostr, cfg.WeComAESKey, cfg.WeComReceiveID)
	if !ok {
		w.WriteHeader(http.StatusBadRequest)
		_, _ = w.Write([]byte("decrypt failed"))
		return
	}
	w.Header().Set("Content-Type", "text/plain")
	_, _ = w.Write([]byte(plain))
}

func handleWeComPost(w http.ResponseWriter, r *http.Request, cfg bridgeConfig, state *bridgeState) {
	q := r.URL.Query()
	signature := firstNonEmpty(q.Get("msg_signature"), q.Get("signature"))
	timestamp := q.Get("timestamp")
	nonce := q.Get("nonce")

	if cfg.WeComToken == "" || cfg.WeComAESKey == "" {
		w.WriteHeader(http.StatusInternalServerError)
		_, _ = w.Write([]byte("missing token or aes key"))
		return
	}

	body, err := readBody(r)
	if err != nil {
		w.WriteHeader(http.StatusBadRequest)
		_, _ = w.Write([]byte("missing body"))
		return
	}

	encrypted := extractEncrypted(body)
	if encrypted == "" {
		w.WriteHeader(http.StatusBadRequest)
		_, _ = w.Write([]byte("missing encrypt"))
		return
	}

	expected := sha1Hex(sortedJoin([]string{cfg.WeComToken, timestamp, nonce, encrypted}))
	if signature == "" || signature != expected {
		w.WriteHeader(http.StatusUnauthorized)
		_, _ = w.Write([]byte("invalid signature"))
		return
	}

	plain, ok := decryptWeCom(encrypted, cfg.WeComAESKey, cfg.WeComReceiveID)
	if !ok {
		w.WriteHeader(http.StatusBadRequest)
		_, _ = w.Write([]byte("decrypt failed"))
		return
	}

	msg := parseWeComMessage(plain)
	if msg == nil {
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte("success"))
		return
	}

	payload := map[string]any{
		"messageId":  firstNonEmpty(msg.MsgID, fmt.Sprintf("%s-%d", msg.FromUser, time.Now().UnixMilli())),
		"sessionId":  msg.FromUser,
		"fromUser":   msg.FromUser,
		"toUser":     msg.ToUser,
		"text":       msg.Content,
		"msgType":    msg.MsgType,
		"mediaId":    msg.MediaID,
		"picUrl":     msg.PicURL,
		"receivedAt": time.Now().UTC().Format(time.RFC3339),
	}

	state.broadcast(payload)
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write([]byte("success"))
}

func handleProxyGetToken(w http.ResponseWriter, r *http.Request, cfg bridgeConfig) {
	if r.Method != http.MethodPost {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}
	if !checkBridgeAuth(w, r, cfg) {
		return
	}

	body, err := readBody(r)
	if err != nil {
		w.WriteHeader(http.StatusBadRequest)
		_, _ = w.Write([]byte("missing body"))
		return
	}
	var payload struct {
		CorpID     string `json:"corpid"`
		CorpSecret string `json:"corpsecret"`
	}
	if err := json.Unmarshal(body, &payload); err != nil {
		w.WriteHeader(http.StatusBadRequest)
		_, _ = w.Write([]byte("invalid json"))
		return
	}
	if payload.CorpID == "" || payload.CorpSecret == "" {
		w.WriteHeader(http.StatusBadRequest)
		_, _ = w.Write([]byte("missing corpid/corpsecret"))
		return
	}

	qs := url.Values{}
	qs.Set("corpid", payload.CorpID)
	qs.Set("corpsecret", payload.CorpSecret)
	endpoint := fmt.Sprintf("https://qyapi.weixin.qq.com/cgi-bin/gettoken?%s", qs.Encode())

	client := http.Client{Timeout: 15 * time.Second}
	resp, err := client.Get(endpoint)
	if err != nil {
		w.WriteHeader(http.StatusBadGateway)
		_, _ = w.Write([]byte("gettoken failed"))
		return
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		w.WriteHeader(http.StatusBadGateway)
		_, _ = w.Write([]byte(fmt.Sprintf("token http %d", resp.StatusCode)))
		return
	}
	data, err := io.ReadAll(resp.Body)
	if err != nil {
		w.WriteHeader(http.StatusBadGateway)
		_, _ = w.Write([]byte("token read failed"))
		return
	}
	w.Header().Set("Content-Type", "application/json")
	_, _ = w.Write(data)
}

func handleProxySend(w http.ResponseWriter, r *http.Request, cfg bridgeConfig) {
	if r.Method != http.MethodPost {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}
	if !checkBridgeAuth(w, r, cfg) {
		return
	}

	body, err := readBody(r)
	if err != nil {
		w.WriteHeader(http.StatusBadRequest)
		_, _ = w.Write([]byte("missing body"))
		return
	}
	var payload struct {
		AccessToken string          `json:"access_token"`
		Message     json.RawMessage `json:"message"`
	}
	if err := json.Unmarshal(body, &payload); err != nil {
		w.WriteHeader(http.StatusBadRequest)
		_, _ = w.Write([]byte("invalid json"))
		return
	}
	if payload.AccessToken == "" || len(payload.Message) == 0 {
		w.WriteHeader(http.StatusBadRequest)
		_, _ = w.Write([]byte("missing access_token/message"))
		return
	}

	endpoint := fmt.Sprintf("https://qyapi.weixin.qq.com/cgi-bin/message/send?access_token=%s", payload.AccessToken)
	client := http.Client{Timeout: 20 * time.Second}
	resp, err := client.Post(endpoint, "application/json", bytes.NewReader(payload.Message))
	if err != nil {
		w.WriteHeader(http.StatusBadGateway)
		_, _ = w.Write([]byte("send failed"))
		return
	}
	defer resp.Body.Close()
	data, err := io.ReadAll(resp.Body)
	if err != nil {
		w.WriteHeader(http.StatusBadGateway)
		_, _ = w.Write([]byte("send read failed"))
		return
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		w.WriteHeader(http.StatusBadGateway)
		_, _ = w.Write([]byte(fmt.Sprintf("send http %d", resp.StatusCode)))
		return
	}

	var result struct {
		ErrCode int `json:"errcode"`
	}
	_ = json.Unmarshal(data, &result)
	if result.ErrCode != 0 {
		w.WriteHeader(http.StatusBadGateway)
		_, _ = w.Write([]byte("send failed"))
		return
	}
	w.Header().Set("Content-Type", "application/json")
	_, _ = w.Write([]byte(`{"errcode":0,"errmsg":"ok"}`))
}

func handleProxyUpload(w http.ResponseWriter, r *http.Request, cfg bridgeConfig) {
	if r.Method != http.MethodPost {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}
	if !checkBridgeAuth(w, r, cfg) {
		return
	}

	body, err := readBody(r)
	if err != nil {
		w.WriteHeader(http.StatusBadRequest)
		_, _ = w.Write([]byte("missing body"))
		return
	}
	var payload struct {
		AccessToken string `json:"access_token"`
		Type        string `json:"type"`
		Media       struct {
			Base64      string `json:"base64"`
			Filename    string `json:"filename"`
			ContentType string `json:"content_type"`
		} `json:"media"`
	}
	if err := json.Unmarshal(body, &payload); err != nil {
		w.WriteHeader(http.StatusBadRequest)
		_, _ = w.Write([]byte("invalid json"))
		return
	}
	if payload.AccessToken == "" || payload.Media.Base64 == "" {
		w.WriteHeader(http.StatusBadRequest)
		_, _ = w.Write([]byte("missing access_token/media"))
		return
	}

	typeName := payload.Type
	if typeName == "" {
		typeName = "image"
	}
	filename := payload.Media.Filename
	if filename == "" {
		if typeName == "image" {
			filename = "upload.jpg"
		} else {
			filename = "upload.dat"
		}
	}
	data, err := base64.StdEncoding.DecodeString(payload.Media.Base64)
	if err != nil {
		w.WriteHeader(http.StatusBadRequest)
		_, _ = w.Write([]byte("invalid base64"))
		return
	}

	endpoint := fmt.Sprintf("https://qyapi.weixin.qq.com/cgi-bin/media/upload?access_token=%s&type=%s", payload.AccessToken, url.QueryEscape(typeName))

	var buf bytes.Buffer
	writer := multipart.NewWriter(&buf)
	part, err := writer.CreateFormFile("media", filename)
	if err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		_, _ = w.Write([]byte("upload failed"))
		return
	}
	_, _ = part.Write(data)
	_ = writer.Close()

	client := http.Client{Timeout: 30 * time.Second}
	req, err := http.NewRequest(http.MethodPost, endpoint, &buf)
	if err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		_, _ = w.Write([]byte("upload failed"))
		return
	}
	req.Header.Set("Content-Type", writer.FormDataContentType())
	resp, err := client.Do(req)
	if err != nil {
		w.WriteHeader(http.StatusBadGateway)
		_, _ = w.Write([]byte("upload failed"))
		return
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		w.WriteHeader(http.StatusBadGateway)
		_, _ = w.Write([]byte(fmt.Sprintf("upload http %d", resp.StatusCode)))
		return
	}
	respData, err := io.ReadAll(resp.Body)
	if err != nil {
		w.WriteHeader(http.StatusBadGateway)
		_, _ = w.Write([]byte("upload read failed"))
		return
	}
	w.Header().Set("Content-Type", "application/json")
	_, _ = w.Write(respData)
}

func handleProxyMediaGet(w http.ResponseWriter, r *http.Request, cfg bridgeConfig) {
	if r.Method != http.MethodPost {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}
	if !checkBridgeAuth(w, r, cfg) {
		return
	}

	body, err := readBody(r)
	if err != nil {
		w.WriteHeader(http.StatusBadRequest)
		_, _ = w.Write([]byte("missing body"))
		return
	}
	var payload struct {
		AccessToken string `json:"access_token"`
		MediaID     string `json:"media_id"`
	}
	if err := json.Unmarshal(body, &payload); err != nil {
		w.WriteHeader(http.StatusBadRequest)
		_, _ = w.Write([]byte("invalid json"))
		return
	}
	if payload.AccessToken == "" || payload.MediaID == "" {
		w.WriteHeader(http.StatusBadRequest)
		_, _ = w.Write([]byte("missing access_token/media_id"))
		return
	}

	query := url.Values{}
	query.Set("access_token", payload.AccessToken)
	query.Set("media_id", payload.MediaID)
	endpoint := fmt.Sprintf("https://qyapi.weixin.qq.com/cgi-bin/media/get?%s", query.Encode())

	client := http.Client{Timeout: 30 * time.Second}
	resp, err := client.Get(endpoint)
	if err != nil {
		w.WriteHeader(http.StatusBadGateway)
		_, _ = w.Write([]byte("media get failed"))
		return
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		w.WriteHeader(http.StatusBadGateway)
		_, _ = w.Write([]byte(fmt.Sprintf("media get http %d", resp.StatusCode)))
		return
	}

	contentType := strings.TrimSpace(resp.Header.Get("Content-Type"))
	respData, err := io.ReadAll(resp.Body)
	if err != nil {
		w.WriteHeader(http.StatusBadGateway)
		_, _ = w.Write([]byte("media get read failed"))
		return
	}

	if strings.Contains(strings.ToLower(contentType), "application/json") {
		var apiErr struct {
			ErrCode int    `json:"errcode"`
			ErrMsg  string `json:"errmsg"`
		}
		_ = json.Unmarshal(respData, &apiErr)
		w.WriteHeader(http.StatusBadGateway)
		_, _ = w.Write([]byte(fmt.Sprintf("media get error %d %s", apiErr.ErrCode, apiErr.ErrMsg)))
		return
	}

	filename := parseFilenameFromDisposition(resp.Header.Get("Content-Disposition"))
	if filename == "" {
		filename = fmt.Sprintf("%s.dat", payload.MediaID)
	}
	result := map[string]any{
		"base64":       base64.StdEncoding.EncodeToString(respData),
		"filename":     filename,
		"content_type": firstNonEmpty(contentType, "application/octet-stream"),
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(result)
}

func checkBridgeAuth(w http.ResponseWriter, r *http.Request, cfg bridgeConfig) bool {
	if cfg.BridgeToken == "" {
		return true
	}
	if r.Header.Get("Authorization") != fmt.Sprintf("Bearer %s", cfg.BridgeToken) {
		w.WriteHeader(http.StatusUnauthorized)
		_, _ = w.Write([]byte("unauthorized"))
		return false
	}
	return true
}

func readBody(r *http.Request) ([]byte, error) {
	body, err := io.ReadAll(io.LimitReader(r.Body, maxBodyBytes))
	if err != nil {
		return nil, err
	}
	if len(body) == 0 {
		return nil, errors.New("empty body")
	}
	return body, nil
}

func extractEncrypted(body []byte) string {
	trimmed := strings.TrimSpace(string(body))
	if strings.HasPrefix(trimmed, "{") {
		var obj map[string]any
		if err := json.Unmarshal([]byte(trimmed), &obj); err != nil {
			return ""
		}
		if v, ok := obj["encrypt"]; ok {
			return fmt.Sprintf("%v", v)
		}
		if v, ok := obj["Encrypt"]; ok {
			return fmt.Sprintf("%v", v)
		}
		return ""
	}
	var doc wecomXML
	if err := xml.Unmarshal(body, &doc); err != nil {
		return ""
	}
	return strings.TrimSpace(doc.Encrypt)
}

func parseWeComMessage(xmlText string) *wecomMessage {
	var doc wecomXML
	if err := xml.Unmarshal([]byte(xmlText), &doc); err != nil {
		return nil
	}
	msgType := strings.TrimSpace(doc.MsgType)
	fromUser := strings.TrimSpace(doc.FromUserName)
	if msgType == "" || fromUser == "" {
		return nil
	}
	msgID := strings.TrimSpace(doc.MsgId)
	if msgID == "" {
		msgID = strings.TrimSpace(doc.MsgID)
	}
	return &wecomMessage{
		MsgType:  msgType,
		Content:  strings.TrimSpace(doc.Content),
		FromUser: fromUser,
		ToUser:   strings.TrimSpace(doc.ToUserName),
		MsgID:    msgID,
		MediaID:  strings.TrimSpace(doc.MediaId),
		PicURL:   strings.TrimSpace(doc.PicUrl),
	}
}

func decryptWeCom(encrypted, aesKey, receiveID string) (string, bool) {
	key, err := base64.StdEncoding.DecodeString(aesKey + "=")
	if err != nil || len(key) != 32 {
		return "", false
	}
	cipherText, err := base64.StdEncoding.DecodeString(encrypted)
	if err != nil {
		return "", false
	}
	if len(cipherText)%aes.BlockSize != 0 {
		return "", false
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		return "", false
	}
	iv := key[:aes.BlockSize]
	mode := cipher.NewCBCDecrypter(block, iv)
	plain := make([]byte, len(cipherText))
	mode.CryptBlocks(plain, cipherText)
	plain = pkcs7Unpad(plain)
	if len(plain) < 20 {
		return "", false
	}
	msgLen := binary.BigEndian.Uint32(plain[16:20])
	msgStart := 20
	msgEnd := msgStart + int(msgLen)
	if msgEnd > len(plain) {
		return "", false
	}
	msg := string(plain[msgStart:msgEnd])
	rid := string(plain[msgEnd:])
	if receiveID != "" && rid != receiveID {
		return "", false
	}
	return msg, true
}

func pkcs7Unpad(buf []byte) []byte {
	if len(buf) == 0 {
		return buf
	}
	pad := int(buf[len(buf)-1])
	if pad < 1 || pad > 32 || pad > len(buf) {
		return buf
	}
	return buf[:len(buf)-pad]
}

func sha1Hex(input string) string {
	h := sha1.Sum([]byte(input))
	return fmt.Sprintf("%x", h)
}

func sortedJoin(parts []string) string {
	filtered := make([]string, 0, len(parts))
	for _, p := range parts {
		if p != "" {
			filtered = append(filtered, p)
		}
	}
	sort.Strings(filtered)
	return strings.Join(filtered, "")
}

func firstNonEmpty(values ...string) string {
	for _, v := range values {
		if strings.TrimSpace(v) != "" {
			return v
		}
	}
	return ""
}

func parseFilenameFromDisposition(disposition string) string {
	trimmed := strings.TrimSpace(disposition)
	if trimmed == "" {
		return ""
	}
	lower := strings.ToLower(trimmed)
	if idx := strings.Index(lower, "filename*=utf-8''"); idx >= 0 {
		start := idx + len("filename*=utf-8''")
		rest := strings.TrimSpace(trimmed[start:])
		if semi := strings.Index(rest, ";"); semi >= 0 {
			rest = rest[:semi]
		}
		rest = strings.Trim(rest, "\"'")
		if decoded, err := url.QueryUnescape(rest); err == nil {
			return decoded
		}
		return rest
	}

	if idx := strings.Index(lower, "filename="); idx >= 0 {
		start := idx + len("filename=")
		rest := strings.TrimSpace(trimmed[start:])
		if semi := strings.Index(rest, ";"); semi >= 0 {
			rest = rest[:semi]
		}
		return strings.Trim(strings.TrimSpace(rest), "\"'")
	}
	return ""
}

func (s *bridgeState) addClient(c *sseClient) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.clients[c] = struct{}{}
}

func (s *bridgeState) removeClient(c *sseClient) {
	s.mu.Lock()
	defer s.mu.Unlock()
	delete(s.clients, c)
}

func (s *bridgeState) broadcast(payload map[string]any) {
	data, err := json.Marshal(payload)
	if err != nil {
		return
	}

	s.mu.Lock()
	id := s.nextEventID
	s.nextEventID++
	event := sseEvent{ID: id, Payload: data}
	s.buffer = append(s.buffer, event)
	if len(s.buffer) > s.bufferCap {
		s.buffer = s.buffer[len(s.buffer)-s.bufferCap:]
	}
	for client := range s.clients {
		select {
		case client.ch <- event:
		default:
		}
	}
	s.mu.Unlock()
}

func (s *bridgeState) getMissed(lastEventID int64) []sseEvent {
	s.mu.Lock()
	defer s.mu.Unlock()
	if len(s.buffer) == 0 {
		return nil
	}
	missed := make([]sseEvent, 0)
	for _, ev := range s.buffer {
		if ev.ID > lastEventID {
			missed = append(missed, ev)
		}
	}
	return missed
}
