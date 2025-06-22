export interface Vector3 {
  x: number;
  y: number;
  z: number;
}

export interface WorldObject {
  id: string;
  type: ObjectType;
  position: Vector3;
  rotation: Vector3;
  scale: Vector3;
  properties?: Record<string, any>;
}

export type ObjectType = 
  | 'tree-simple'
  | 'tree-evergreen' 
  | 'tree-berry'
  | 'ground-plane'
  | 'water-plane';

export interface BerryTreeProperties {
  berryType: 'blueberry' | 'strawberry' | 'greenberry' | 'goldberry';
  treeId: string;
}

export interface WorldConfiguration {
  id: string;
  name: string;
  description: string;
  created: number;
  modified: number;
  objects: WorldObject[];
  metadata?: {
    bounds?: {
      minX: number;
      maxX: number;
      minZ: number;
      maxZ: number;
    };
    lighting?: {
      ambientIntensity: number;
      pointLights: Array<{
        position: Vector3;
        intensity: number;
        color?: string;
      }>;
    };
  };
}

export interface ObjectTemplate {
  type: ObjectType;
  name: string;
  description: string;
  defaultScale: Vector3;
  modelPath?: string;
  icon?: string;
  category: 'nature' | 'terrain' | 'structures';
}
