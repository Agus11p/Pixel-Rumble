import type { JSX } from 'react';
import type { Offer } from '../../core/chaosbox';
import { objectType } from '../../core/objects/catalog';
import type { MatchSnapshotState } from '../../net/MatchSession';
import { colorHex } from '../../rooms/colors';
import type { RoomPlayer } from '../../rooms/types';

interface Props {
  state: MatchSnapshotState;
  byId: Map<string, RoomPlayer>;
  canPick: boolean;
  onPick: (offerId: number) => void;
}

/**
 * Fase de eleccion (§13, §15).
 *
 * Todos eligen a la vez y hay dos objetos mas que jugadores, asi que nadie se
 * queda con las manos vacias por ser el ultimo: lo que se disputa es el objeto
 * bueno. Cuando alguien reclama uno, desaparece para el resto al instante, sin
 * mensajes de empate.
 */
export function ChaosBoxPanel({ state, byId, canPick, onPick }: Props): JSX.Element {
  const mine = state.myOffer;

  return (
    <div className="phase-overlay">
      <div className="phase-panel">
        <div className="phase-head">
          <h2 className="screen-title-text">CHAOS BOX</h2>
          <span className="phase-timer">{Math.ceil(state.phaseLeft)}</span>
        </div>

        <p className="note">
          {mine
            ? 'Ya tenés tu objeto. Esperá a los demás…'
            : canPick
              ? 'Elegí un objeto para agregar al mapa'
              : 'Mirando cómo eligen los demás'}
        </p>

        <div className="offer-grid">
          {state.offers.map((offer) => (
            <OfferCard
              key={offer.id}
              offer={offer}
              takerColor={
                offer.takenBy ? colorHex(byId.get(offer.takenBy)?.color ?? -1) : undefined
              }
              takerName={offer.takenBy ? (byId.get(offer.takenBy)?.name ?? '') : undefined}
              mine={mine?.id === offer.id}
              disabled={!canPick || Boolean(mine) || Boolean(offer.takenBy)}
              onPick={() => onPick(offer.id)}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function OfferCard({
  offer,
  takerColor,
  takerName,
  mine,
  disabled,
  onPick,
}: {
  offer: Offer;
  takerColor?: string;
  takerName?: string;
  mine: boolean;
  disabled: boolean;
  onPick: () => void;
}): JSX.Element {
  const type = objectType(offer.type);
  if (!type) return <div className="offer-card" />;

  // Miniatura con las proporciones reales del objeto.
  const scale = Math.min(52 / type.w, 34 / type.h);

  return (
    <button
      className={`offer-card ${mine ? 'mine' : ''} ${offer.takenBy ? 'taken' : ''}`}
      style={mine && takerColor ? { borderColor: takerColor } : undefined}
      disabled={disabled}
      onClick={onPick}
    >
      <span className="offer-shape-box">
        <span
          className="offer-shape"
          style={{
            width: `${Math.max(4, type.w * scale)}px`,
            height: `${Math.max(4, type.h * scale)}px`,
            background: `#${type.color.toString(16).padStart(6, '0')}`,
            borderTop: `2px solid #${type.accent.toString(16).padStart(6, '0')}`,
          }}
        />
      </span>
      <span className="offer-name">{type.name}</span>
      <span className="offer-hint">{type.hint}</span>
      <span className="offer-category">{type.category}</span>
      {offer.takenBy && (
        <span className="offer-taken" style={{ color: takerColor }}>
          {mine ? 'TUYO' : (takerName ?? 'TOMADO')}
        </span>
      )}
    </button>
  );
}
