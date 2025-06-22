import { create } from 'zustand';
import { WorldConfiguration, WorldObject, ObjectType, Vector3 } from '../types/WorldTypes';

interface WorldBuilderState {
  // Current world being edited
  currentWorld: WorldConfiguration | null;
  
  // UI state
  selectedObjectId: string | null;
  isPreviewMode: boolean;
  showGrid: boolean;
  snapToGrid: boolean;
  gridSize: number;
  
  // Camera state
  cameraPosition: Vector3;
  cameraTarget: Vector3;
  
  // Actions
  setCurrentWorld: (world: WorldConfiguration | null) => void;
  addObject: (type: ObjectType, position: Vector3) => void;
  updateObject: (id: string, updates: Partial<WorldObject>) => void;
  removeObject: (id: string) => void;
  selectObject: (id: string | null) => void;
  setPreviewMode: (enabled: boolean) => void;
  setShowGrid: (show: boolean) => void;
  setSnapToGrid: (snap: boolean) => void;
  setGridSize: (size: number) => void;
  setCameraPosition: (position: Vector3) => void;
  setCameraTarget: (target: Vector3) => void;
  
  // World management
  createNewWorld: (name: string, description?: string) => void;
  saveWorld: () => void;
  loadWorld: (world: WorldConfiguration) => void;
  exportWorld: () => string;
  importWorld: (jsonData: string) => boolean;
}

const generateId = () => Math.random().toString(36).substr(2, 9);

export const useWorldBuilderStore = create<WorldBuilderState>((set, get) => ({
  // Initial state
  currentWorld: null,
  selectedObjectId: null,
  isPreviewMode: false,
  showGrid: true,
  snapToGrid: true,
  gridSize: 1,
  cameraPosition: { x: 10, y: 10, z: 10 },
  cameraTarget: { x: 0, y: 0, z: 0 },
  
  // Actions
  setCurrentWorld: (world) => set({ currentWorld: world }),
  
  addObject: (type, position) => {
    const state = get();
    if (!state.currentWorld) return;
    
    const newObject: WorldObject = {
      id: generateId(),
      type,
      position: state.snapToGrid ? {
        x: Math.round(position.x / state.gridSize) * state.gridSize,
        y: position.y,
        z: Math.round(position.z / state.gridSize) * state.gridSize,
      } : position,
      rotation: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1, z: 1 },
    };
    
    // Add type-specific properties
    if (type === 'tree-berry') {
      newObject.properties = {
        berryType: 'blueberry',
        treeId: `tree_${newObject.id}`,
      };
    }
    
    set({
      currentWorld: {
        ...state.currentWorld,
        objects: [...state.currentWorld.objects, newObject],
        modified: Date.now(),
      },
      selectedObjectId: newObject.id,
    });
  },
  
  updateObject: (id, updates) => {
    const state = get();
    if (!state.currentWorld) return;
    
    set({
      currentWorld: {
        ...state.currentWorld,
        objects: state.currentWorld.objects.map(obj =>
          obj.id === id ? { ...obj, ...updates } : obj
        ),
        modified: Date.now(),
      },
    });
  },
  
  removeObject: (id) => {
    const state = get();
    if (!state.currentWorld) return;
    
    set({
      currentWorld: {
        ...state.currentWorld,
        objects: state.currentWorld.objects.filter(obj => obj.id !== id),
        modified: Date.now(),
      },
      selectedObjectId: state.selectedObjectId === id ? null : state.selectedObjectId,
    });
  },
  
  selectObject: (id) => set({ selectedObjectId: id }),
  setPreviewMode: (enabled) => set({ isPreviewMode: enabled, selectedObjectId: enabled ? null : get().selectedObjectId }),
  setShowGrid: (show) => set({ showGrid: show }),
  setSnapToGrid: (snap) => set({ snapToGrid: snap }),
  setGridSize: (size) => set({ gridSize: size }),
  setCameraPosition: (position) => set({ cameraPosition: position }),
  setCameraTarget: (target) => set({ cameraTarget: target }),
  
  createNewWorld: (name, description = '') => {
    const newWorld: WorldConfiguration = {
      id: generateId(),
      name,
      description,
      created: Date.now(),
      modified: Date.now(),
      objects: [],
      metadata: {
        bounds: { minX: -25, maxX: 25, minZ: -25, maxZ: 25 },
        lighting: {
          ambientIntensity: 0.4,
          pointLights: [
            { position: { x: 10, y: 30, z: 0 }, intensity: 0.5 }
          ]
        }
      }
    };
    
    set({ 
      currentWorld: newWorld,
      selectedObjectId: null,
      isPreviewMode: false,
    });
  },
  
  saveWorld: () => {
    const state = get();
    if (!state.currentWorld) return;
    
    // Save to localStorage for now
    const savedWorlds = JSON.parse(localStorage.getItem('worldBuilder_savedWorlds') || '[]');
    const existingIndex = savedWorlds.findIndex((w: WorldConfiguration) => w.id === state.currentWorld!.id);
    
    if (existingIndex >= 0) {
      savedWorlds[existingIndex] = state.currentWorld;
    } else {
      savedWorlds.push(state.currentWorld);
    }
    
    localStorage.setItem('worldBuilder_savedWorlds', JSON.stringify(savedWorlds));
  },
  
  loadWorld: (world) => {
    set({
      currentWorld: world,
      selectedObjectId: null,
      isPreviewMode: false,
    });
  },
  
  exportWorld: () => {
    const state = get();
    if (!state.currentWorld) return '';
    return JSON.stringify(state.currentWorld, null, 2);
  },
  
  importWorld: (jsonData) => {
    try {
      const world = JSON.parse(jsonData) as WorldConfiguration;
      // Basic validation
      if (!world.id || !world.name || !Array.isArray(world.objects)) {
        return false;
      }
      set({ currentWorld: world, selectedObjectId: null, isPreviewMode: false });
      return true;
    } catch {
      return false;
    }
  },
}));
