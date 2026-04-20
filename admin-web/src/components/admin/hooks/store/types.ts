import type { StateCreator } from "zustand";
import type {
  AdminEvolutionSlice,
  AdminCelestiaSlice,
  AdminMarketExecutionSlice,
  AdminMarketPortfolioSlice,
  AdminMessagesSlice,
  AdminPageSlice,
  AdminSharedSlice,
  AdminSystemSlice,
  AdminTopicSlice,
  AdminWritingSlice
} from "./slices";

export type AdminStore = AdminPageSlice
  & AdminSharedSlice
  & AdminSystemSlice
  & AdminMessagesSlice
  & AdminMarketPortfolioSlice
  & AdminMarketExecutionSlice
  & AdminTopicSlice
  & AdminWritingSlice
  & AdminCelestiaSlice
  & AdminEvolutionSlice;

export type AdminSliceCreator<T> = StateCreator<AdminStore, [], [], T>;
