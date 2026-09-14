import { useEffect, useRef } from 'react';
import { Game } from '../../game/Game';
import { useAppStore } from '../../store/appStore';
import type { JSX } from 'react';

/**
 * El prototipo local de F1, ahora accesible desde el menu.
 * Sirve para probar el feel y para ajustar la fisica sin depender de la red.
 */
export function LocalGameScreen(): JSX.Element {
  const hostRef = useRef<HTMLDivElement>(null);
  const setScreen = useAppStore((s) => s.setScreen);

  useEffect(() => {
    const parent = hostRef.current;
    if (!parent) return;
    const game = new Game();
    let cancelled = false;
    void game.start(parent).then(() => {
      if (cancelled) game.destroy();
    });
    return () => {
      cancelled = true;
      game.destroy();
    };
  }, []);

  return (
    <div className="game-host" ref={hostRef}>
      <button className="btn btn-back" onClick={() => setScreen('title')}>
        ← MENÚ
      </button>
    </div>
  );
}
