import { useShallow } from "zustand/react/shallow";
import { useAdminStore } from "./useAdminStore";

export function useWeComMenuSectionState() {
  const state = useAdminStore(useShallow((store) => ({
    wecomMenuConfig: store.wecomMenuConfig,
    wecomMenuEvents: store.wecomMenuEvents,
    wecomMenuPublishPayload: store.wecomMenuPublishPayload,
    wecomMenuValidationErrors: store.wecomMenuValidationErrors,
    savingWecomMenu: store.savingWecomMenu,
    publishingWecomMenu: store.publishingWecomMenu,
    setWecomMenuConfig: store.setWecomMenuConfig,
    loadWeComMenu: store.loadWeComMenu,
    handleSaveWeComMenu: store.handleSaveWeComMenu,
    handlePublishWeComMenu: store.handlePublishWeComMenu
  })));

  return {
    config: state.wecomMenuConfig,
    recentEvents: state.wecomMenuEvents,
    publishPayload: state.wecomMenuPublishPayload,
    validationErrors: state.wecomMenuValidationErrors,
    saving: state.savingWecomMenu,
    publishing: state.publishingWecomMenu,
    onConfigChange: state.setWecomMenuConfig,
    onRefresh: () => {
      void state.loadWeComMenu();
    },
    onSave: () => {
      void state.handleSaveWeComMenu();
    },
    onPublish: () => {
      void state.handlePublishWeComMenu();
    }
  };
}
