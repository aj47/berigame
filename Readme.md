# BeriGame

A multiplayer 3D island survival game built with React Three Fiber and serverless backend.

## Features

- **3D Multiplayer World**: Real-time multiplayer gameplay with WebSocket connections
- **Resource Harvesting**: Collect berries from interactive trees
- **Combat System**: Player vs player combat mechanics
- **World Builder**: Visual map editor for creating custom game worlds
- **Serverless Backend**: AWS Lambda + DynamoDB for scalable multiplayer

## Project Structure

```
├── frontend/           # React Three Fiber game client
├── backend/           # Serverless backend (AWS Lambda)
├── world-builder/     # Visual world editor tool
├── models/           # 3D models and assets
└── landing-page/     # Marketing website
```

## Getting Started

### Main Game (Frontend)

1. Install dependencies:
   ```bash
   cd frontend
   npm install
   ```

2. Start development server:
   ```bash
   npm run dev
   ```

3. Open http://localhost:5173

### World Builder

1. Install dependencies:
   ```bash
   cd world-builder
   npm install
   ```

2. Start development server:
   ```bash
   npm run dev
   ```

3. Open http://localhost:3002

### Backend

1. Install dependencies:
   ```bash
   cd backend
   npm install
   ```

2. Configure AWS credentials and deploy:
   ```bash
   serverless deploy
   ```

## World Builder

The world builder is a separate application that allows you to visually design game maps:

- **Visual Editor**: Drag and drop objects in 3D space
- **Object Library**: Trees, terrain, and interactive elements
- **Save/Load**: Persistent world configurations
- **Export/Import**: Share worlds as JSON files
- **Live Preview**: Test your creations in real-time

Created worlds automatically integrate with the main game through the `WorldLoader` component.

## Development

### Adding New Features

1. **New Object Types**: Add to world builder object templates and main game renderers
2. **Game Mechanics**: Implement in backend with proper validation
3. **UI Components**: Follow existing React Three Fiber patterns

### Architecture

- **Frontend**: React + Three.js for 3D rendering
- **State Management**: Zustand for client state
- **Backend**: Serverless functions with DynamoDB
- **Real-time**: WebSocket API Gateway for multiplayer
- **Security**: Server-side validation for all game actions

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test thoroughly
5. Submit a pull request

## License

[Add license information]