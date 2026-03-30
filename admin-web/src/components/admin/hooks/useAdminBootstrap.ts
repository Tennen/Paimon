import { useEffect } from "react";
import { useAdminStore } from "./useAdminStore";

export function useAdminBootstrap() {
  const bootstrap = useAdminStore((state) => state.bootstrap);
  const activeMenu = useAdminStore((state) => state.activeMenu);
  const loadEvolutionState = useAdminStore((state) => state.loadEvolutionState);

  useEffect(() => {
    void bootstrap();
  }, [bootstrap]);

  useEffect(() => {
    if (activeMenu !== "evolution") {
      return;
    }

    void loadEvolutionState({ silent: true });
    const timer = window.setInterval(() => {
      void loadEvolutionState({ silent: true });
    }, 8000);

    return () => {
      window.clearInterval(timer);
    };
  }, [activeMenu, loadEvolutionState]);
}
