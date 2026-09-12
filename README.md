# BahiaClient v0.2.0

Cliente personalizado de HaxBall hecho con Electron.

## Requisitos
- [Node.js](https://nodejs.org/) v18 o superior
- npm (viene con Node)

## Correr en desarrollo

```bash
# 1. Instalar dependencias (solo la primera vez)
npm install

# 2. Arrancar
npm start
```

## Generar el .exe instalador

```bash
npm run build
```

El instalador queda en `/dist/BahiaClient Setup x.x.x.exe`

## Estructura

```
bahiaclient/
├── main.js          ← proceso principal Electron
├── preload.js       ← bridge seguro main ↔ renderer
├── renderer/
│   └── index.html   ← el launcher (UI completa)
├── assets/
│   └── icon.ico     ← ícono de la app (agregar vos)
└── package.json
```

## Próximos pasos

- [ ] Conectar a `api2.haxball.com/list` para salas reales
- [ ] Abrir HaxBall en un BrowserView al hacer "Entrar"
- [ ] Sistema de login / perfil
- [ ] Clanes y amigos
- [ ] Overlay ingame (FPS, ping, sonidos de gol)
- [ ] Modo streamer
