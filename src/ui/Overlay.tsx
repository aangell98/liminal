export function Overlay({ started, onEnter, mobile }: { started: boolean; onEnter: () => void; mobile?: boolean }) {
  return (
    <div className="overlay">
      <div className="panel">
        <h1>LIMINAL</h1>
        <p className="tag">Nivel 0 · “El zumbido”</p>
        <p className="hint">
          {mobile
            ? 'Joystick moverte · Arrastra para mirar · CORRER y SIGILO (pulsa para activar)'
            : 'WASD moverte · Ratón mirar · Shift correr · C sigilo · Esc liberar cursor'}
        </p>
        <button onClick={onEnter}>{started ? 'Continuar' : 'Entrar'}</button>
        <p className="warn">Sube el volumen para la experiencia completa.</p>
      </div>
    </div>
  )
}
