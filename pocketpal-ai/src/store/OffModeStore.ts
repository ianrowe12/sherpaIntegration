import {makeAutoObservable, runInAction} from 'mobx';
import AsyncStorage from '@react-native-async-storage/async-storage';

const STORAGE_KEY = 'chat-off-mode-state';

class OffModeStore {
  private _state: Record<string, boolean> = {};

  constructor() {
    makeAutoObservable(this);
    this.hydrate();
  }

  private async hydrate() {
    try {
      const raw = await AsyncStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') {
          runInAction(() => {
            this._state = parsed;
          });
        }
      }
    } catch (error) {
      console.warn('[OffModeStore] hydrate failed', error);
    }
  }

  private async persistState(next: Record<string, boolean>) {
    try {
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch (error) {
      console.warn('[OffModeStore] persist failed', error);
    }
  }

  async getValueAsync(sessionId?: string | null) {
    const key = sessionId ?? '__global__';
    if (key in this._state) {
      return this._state[key];
    }
    try {
      const raw = await AsyncStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object' && key in parsed) {
          runInAction(() => {
            this._state = parsed;
          });
          return parsed[key];
        }
      }
    } catch (error) {
      console.warn('[OffModeStore] getValueAsync failed', error);
    }
    return false;
  }

  getValue(sessionId?: string | null) {
    const key = sessionId ?? '__global__';
    return this._state[key] ?? false;
  }

  setValue(value: boolean, sessionId?: string | null) {
    const key = sessionId ?? '__global__';
    if (this._state[key] === value) {
      return;
    }
    const next = {...this._state, [key]: value};
    runInAction(() => {
      this._state = next;
    });
    this.persistState(next).catch(() => {});
  }
}

export const offModeStore = new OffModeStore();

