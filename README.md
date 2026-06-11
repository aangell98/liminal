# LIMINAL

> Nivel 0: *"El zumbido"*

**Liminal** es un juego de terror en primera persona inspirado en los **Backrooms**: un edificio de oficinas infinito, reimaginado mil veces hasta perder todo sentido, bañado en una luz fluorescente amarilla enferma y el zumbido eterno de los fluorescentes. Eres un intruso en un lugar que no debería existir... y algo ya sabe que estás aquí.

🎮 **Juega ahora:** **[aangell98.github.io/liminal](https://aangell98.github.io/liminal/)**

> 🔊 Usa auriculares y sube el volumen: el audio es posicional y buena parte de la tensión está en lo que *oyes* antes de ver.

![Gameplay](docs/gameplay.png)

---

## La experiencia

- **Estética found-footage.** Cámara retro con marco de grabación, indicador `REC`, fecha/hora, grano, distorsión de lente ojo de pez y aberración cromática. Pareces estar viendo una cinta encontrada.
- **Backrooms fieles al lore.** Pasillos sin sentido, estancias que no conectan, paredes amarillas brillantes, moqueta húmeda y oscura, columnas y geometría imposible. Claustrofóbico a propósito.
- **La Entidad.** No hay salida. Solo *ella*. Una IA directora omnisciente que te acecha, te escucha, te flanquea y, tarde o temprano, te caza: el 100 % de las veces.
- **Anomalías.** El mundo glitchea: apagones, pasos imposibles que giran a tu alrededor, susurros, temblores lejanos.
- **Audio procedimental.** Todo el sonido (zumbido eléctrico, pisadas, respiración, risas distorsionadas) se genera en tiempo real con la Web Audio API. Sin samples.

![Menú](docs/menu.png)

## La Entidad

Diseñada bajo una única premisa: **el jugador es un intruso y la Entidad es la dueña del mundo.**

- Curiosa al principio: acecha desde la distancia, asoma y se retira.
- Te **oye**: correr te delata, el sigilo (`C`) apenas hace ruido. Caminar es un término medio.
- Te **persigue** con pathfinding A\*, predice tu trayectoria y te corta el paso.
- Su sola presencia **mata la luz**: los fluorescentes a su alrededor parpadean violentamente y chisporrotean, un aviso diegético de por dónde viene.
- El *dread* solo sube: cuanto más sobrevives, más implacable se vuelve.

No vas a escapar. Solo puedes retrasar lo inevitable.

![La señal se corrompe cuando se acerca](docs/entity.png)

## Controles

| Tecla | Acción |
|-------|--------|
| `WASD` | Moverte |
| `Ratón` | Mirar |
| `Shift` | Correr (haces ruido) |
| `C` | Sigilo (silencioso, lento) |
| `Esc` | Liberar el cursor |

## Stack técnico

- **[React 19](https://react.dev/)** + **TypeScript** (modo estricto)
- **[React Three Fiber](https://r3f.docs.pmnd.rs/)** + **[Three.js](https://threejs.org/)** para el render 3D
- **[@react-three/drei](https://github.com/pmndrs/drei)** y **[postprocessing](https://github.com/pmndrs/postprocessing)** para los efectos de cámara
- **Web Audio API** para todo el sonido procedimental
- **[Vite](https://vite.dev/)** como bundler
- Despliegue continuo en **GitHub Pages** vía **GitHub Actions**

## Desarrollo local

```bash
npm install
npm run dev      # servidor de desarrollo en http://localhost:5173
npm run build    # build de producción en dist/
npm run preview  # sirve el build de producción localmente
npm run lint     # ESLint
```

## Despliegue

Cada `push` a `main` dispara el workflow de GitHub Actions (`.github/workflows/deploy.yml`), que compila el proyecto y lo publica en GitHub Pages automáticamente.

---

*Proyecto personal y sin ánimo de lucro, hecho por amor al género liminal/Backrooms.*
