export function Overlay({ started, onEnter }: { started: boolean; onEnter: () => void }) {
  return (
    <div className="overlay">
      <div className="panel">
        <h1>LIMINAL</h1>
        <p className="tag">Nivel 0 — “El zumbido”</p>
        <p className="hint">WASD moverte · Ratón mirar · Shift correr · C sigilo · Esc liberar cursor</p>
        <button onClick={onEnter}>{started ? 'Continuar' : 'Entrar'}</button>
        <p className="warn">Sube el volumen para la experiencia completa.</p>
      </div>
    </div>
  )
}
