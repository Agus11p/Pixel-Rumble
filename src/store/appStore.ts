import { create } from 'zustand';

export type Screen = 'title' | 'create' | 'join' | 'lobby' | 'local';

const NAME_KEY = 'pixel-rumble:name';

interface AppState {
  screen: Screen;
  userId: string | null;
  playerName: string;
  roomId: string | null;
  authError: string | null;

  setScreen: (screen: Screen) => void;
  setUserId: (id: string | null) => void;
  setPlayerName: (name: string) => void;
  enterRoom: (roomId: string) => void;
  exitRoom: () => void;
  setAuthError: (message: string | null) => void;
}

function storedName(): string {
  try {
    return localStorage.getItem(NAME_KEY) ?? '';
  } catch {
    return '';
  }
}

export const useAppStore = create<AppState>((set) => ({
  screen: 'title',
  userId: null,
  // El nombre se recuerda entre sesiones por comodidad, pero no es una cuenta:
  // se puede cambiar en cualquier momento (§6).
  playerName: storedName(),
  roomId: null,
  authError: null,

  setScreen: (screen) => set({ screen }),
  setUserId: (userId) => set({ userId }),
  setPlayerName: (playerName) => {
    try {
      localStorage.setItem(NAME_KEY, playerName);
    } catch {
      /* modo privado: seguimos sin recordar el nombre */
    }
    set({ playerName });
  },
  enterRoom: (roomId) => set({ roomId, screen: 'lobby' }),
  exitRoom: () => set({ roomId: null, screen: 'title' }),
  setAuthError: (authError) => set({ authError }),
}));
