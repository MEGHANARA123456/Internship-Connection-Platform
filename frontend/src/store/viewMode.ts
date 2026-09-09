import { create } from 'zustand'

type ViewModeState = {
  isMobileView: boolean
  toggleMobileView: () => void
  setMobileView: (val: boolean) => void
}

export const useViewModeStore = create<ViewModeState>((set) => ({
  isMobileView: false,
  toggleMobileView: () => set((state) => ({ isMobileView: !state.isMobileView })),
  setMobileView: (val: boolean) => set({ isMobileView: val }),
}))
