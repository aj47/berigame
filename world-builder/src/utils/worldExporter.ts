import { WorldConfiguration } from '../types/WorldTypes';

export const exportWorldToFile = (world: WorldConfiguration) => {
  const dataStr = JSON.stringify(world, null, 2);
  const dataUri = 'data:application/json;charset=utf-8,'+ encodeURIComponent(dataStr);
  
  const exportFileDefaultName = `${world.name.replace(/[^a-z0-9]/gi, '_').toLowerCase()}_world.json`;
  
  const linkElement = document.createElement('a');
  linkElement.setAttribute('href', dataUri);
  linkElement.setAttribute('download', exportFileDefaultName);
  linkElement.click();
};

export const importWorldFromFile = (): Promise<WorldConfiguration | null> => {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    
    input.onchange = (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) {
        resolve(null);
        return;
      }
      
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const world = JSON.parse(e.target?.result as string) as WorldConfiguration;
          // Basic validation
          if (!world.id || !world.name || !Array.isArray(world.objects)) {
            resolve(null);
            return;
          }
          resolve(world);
        } catch {
          resolve(null);
        }
      };
      reader.readAsText(file);
    };
    
    input.click();
  });
};

export const getSavedWorlds = (): WorldConfiguration[] => {
  try {
    return JSON.parse(localStorage.getItem('worldBuilder_savedWorlds') || '[]');
  } catch {
    return [];
  }
};

export const deleteSavedWorld = (worldId: string) => {
  const savedWorlds = getSavedWorlds();
  const filtered = savedWorlds.filter(w => w.id !== worldId);
  localStorage.setItem('worldBuilder_savedWorlds', JSON.stringify(filtered));
};
