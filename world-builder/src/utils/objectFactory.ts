import { ObjectTemplate, ObjectType } from '../types/WorldTypes';

export const OBJECT_TEMPLATES: Record<ObjectType, ObjectTemplate> = {
  'tree-simple': {
    type: 'tree-simple',
    name: 'Simple Tree',
    description: 'A basic tree model',
    defaultScale: { x: 1, y: 1, z: 1 },
    modelPath: '/tree-simple.glb',
    category: 'nature',
  },
  'tree-evergreen': {
    type: 'tree-evergreen',
    name: 'Evergreen Tree',
    description: 'An evergreen tree model',
    defaultScale: { x: 1, y: 1, z: 1 },
    modelPath: '/tree-evergreen.glb',
    category: 'nature',
  },
  'tree-berry': {
    type: 'tree-berry',
    name: 'Berry Tree',
    description: 'A tree that produces berries',
    defaultScale: { x: 1, y: 1, z: 1 },
    modelPath: '/tree.glb',
    category: 'nature',
  },
  'ground-plane': {
    type: 'ground-plane',
    name: 'Ground Plane',
    description: 'A ground surface',
    defaultScale: { x: 50, y: 50, z: 1 },
    category: 'terrain',
  },
  'water-plane': {
    type: 'water-plane',
    name: 'Water Plane',
    description: 'A water surface',
    defaultScale: { x: 500, y: 500, z: 1 },
    category: 'terrain',
  },
};

export const getObjectsByCategory = (category: string) => {
  return Object.values(OBJECT_TEMPLATES).filter(template => template.category === category);
};

export const getAllCategories = () => {
  const categories = new Set(Object.values(OBJECT_TEMPLATES).map(t => t.category));
  return Array.from(categories);
};
