# BeriGame World Builder

A visual world editor for creating and designing game maps for BeriGame. This tool allows you to place objects like trees and terrain elements, then save and load different world configurations.

## Features

- **Visual 3D Editor**: Drag and drop objects in a 3D environment
- **Object Palette**: Choose from available objects (trees, ground planes, water)
- **Transform Controls**: Adjust position, rotation, and scale of objects
- **World Management**: Save, load, export, and import world configurations
- **Preview Mode**: Test your world without editing capabilities
- **Grid System**: Optional grid display and snap-to-grid functionality

## Getting Started

1. **Install Dependencies**:
   ```bash
   npm install
   ```

2. **Start the Development Server**:
   ```bash
   npm run dev
   ```

3. **Open in Browser**:
   Navigate to `http://localhost:3002`

## How to Use

### Creating a New World

1. Click "New World" in the left sidebar
2. Enter a name and optional description
3. Click "Create" to start building

### Adding Objects

1. Select an object type from the Object Palette
2. Click the object button to add it to the scene
3. The object will appear at the origin (0,0,0)
4. Click on the object to select it
5. Use the property panel to adjust position, rotation, and scale

### Object Types

- **Tree Simple**: Basic tree model
- **Tree Evergreen**: Evergreen tree model  
- **Tree Berry**: Interactive berry tree (supports different berry types)
- **Ground Plane**: Terrain surface
- **Water Plane**: Water surface

### Saving and Loading

- **Save World**: Saves to browser localStorage
- **Load World**: Choose from previously saved worlds
- **Export**: Download world as JSON file
- **Import**: Load world from JSON file

### Preview Mode

Toggle "Preview Mode" to see how your world looks without editing controls. This gives you a clean view of your creation.

## Integration with Main Game

The world builder integrates with the main BeriGame through the `WorldLoader` component:

1. Create your world in the world builder
2. Save it to localStorage
3. The main game will automatically load saved worlds
4. If no saved world exists, it falls back to the original hardcoded layout

## File Structure

```
world-builder/
├── src/
│   ├── components/          # React components
│   │   ├── WorldBuilderCanvas.tsx    # Main 3D canvas
│   │   ├── ObjectPalette.tsx         # Object selection sidebar
│   │   ├── WorldSaver.tsx            # Save/load functionality
│   │   └── ...
│   ├── store/               # State management
│   │   └── worldBuilderStore.ts      # Zustand store
│   ├── types/               # TypeScript definitions
│   │   └── WorldTypes.ts             # World data structures
│   ├── utils/               # Utility functions
│   │   ├── objectFactory.ts          # Object templates
│   │   └── worldExporter.ts          # Import/export logic
│   └── App.tsx              # Main application
├── public/                  # Static assets (symlinked from main frontend)
└── package.json
```

## World Data Format

Worlds are saved as JSON with the following structure:

```json
{
  "id": "unique-id",
  "name": "World Name",
  "description": "Optional description",
  "created": 1234567890,
  "modified": 1234567890,
  "objects": [
    {
      "id": "object-id",
      "type": "tree-berry",
      "position": { "x": 0, "y": 0, "z": 0 },
      "rotation": { "x": 0, "y": 0, "z": 0 },
      "scale": { "x": 1, "y": 1, "z": 1 },
      "properties": {
        "berryType": "blueberry",
        "treeId": "tree_unique_id"
      }
    }
  ],
  "metadata": {
    "bounds": { "minX": -25, "maxX": 25, "minZ": -25, "maxZ": 25 },
    "lighting": {
      "ambientIntensity": 0.4,
      "pointLights": [...]
    }
  }
}
```

## Development

### Adding New Object Types

1. Add the new type to `ObjectType` in `WorldTypes.ts`
2. Create a template in `objectFactory.ts`
3. Add rendering logic in `WorldBuilderCanvas.tsx`
4. Update the `WorldLoader.tsx` in the main game

### Extending Functionality

The world builder is designed to be extensible. You can add:
- New object types and properties
- Advanced transform controls
- Terrain editing tools
- Lighting configuration
- Physics simulation
- Multiplayer collaboration

## Troubleshooting

- **Models not loading**: Ensure 3D model files are in the `public` directory
- **Save/load issues**: Check browser localStorage permissions
- **Performance**: Large worlds with many objects may impact performance

## Future Enhancements

- Terrain sculpting tools
- Advanced lighting controls
- Physics object placement
- Collaborative editing
- Backend integration for persistent storage
- Asset management system
