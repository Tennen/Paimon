import { create } from "zustand";
import { createCelestiaSlice } from "./store/celestiaSlice";
import { createEvolutionSlice } from "./store/evolutionSlice";
import { createMarketExecutionSlice } from "./store/marketExecutionSlice";
import { createMarketPortfolioSlice } from "./store/marketPortfolioSlice";
import { createMessagesSlice } from "./store/messagesSlice";
import { createPageSlice } from "./store/pageSlice";
import { createSharedSlice } from "./store/sharedSlice";
import { createSystemSlice } from "./store/systemSlice";
import { createTopicSlice } from "./store/topicSlice";
import type { AdminStore } from "./store/types";
import { createWritingSlice } from "./store/writingSlice";

export const useAdminStore = create<AdminStore>()((...args) => ({
  ...createPageSlice(...args),
  ...createSharedSlice(...args),
  ...createSystemSlice(...args),
  ...createMessagesSlice(...args),
  ...createMarketPortfolioSlice(...args),
  ...createMarketExecutionSlice(...args),
  ...createTopicSlice(...args),
  ...createWritingSlice(...args),
  ...createCelestiaSlice(...args),
  ...createEvolutionSlice(...args)
}));
