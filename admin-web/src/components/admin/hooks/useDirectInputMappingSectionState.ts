import { useShallow } from "zustand/react/shallow";
import { useAdminStore } from "./useAdminStore";

export function useDirectInputMappingSectionState() {
  const state = useAdminStore(useShallow((store) => ({
    directInputMappingConfig: store.directInputMappingConfig,
    savingDirectInputMappings: store.savingDirectInputMappings,
    setDirectInputMappingConfig: store.setDirectInputMappingConfig,
    loadDirectInputMappings: store.loadDirectInputMappings,
    handleSaveDirectInputMappings: store.handleSaveDirectInputMappings
  })));

  return {
    config: state.directInputMappingConfig,
    saving: state.savingDirectInputMappings,
    onConfigChange: state.setDirectInputMappingConfig,
    onRefresh: () => {
      void state.loadDirectInputMappings();
    },
    onSave: () => {
      void state.handleSaveDirectInputMappings();
    }
  };
}
