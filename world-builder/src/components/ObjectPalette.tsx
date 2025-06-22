import React from 'react';
import { useWorldBuilderStore } from '../store/worldBuilderStore';
import { OBJECT_TEMPLATES, getAllCategories, getObjectsByCategory } from '../utils/objectFactory';
import { ObjectType } from '../types/WorldTypes';

const ObjectPalette: React.FC = () => {
  const { currentWorld, selectedObjectId, removeObject } = useWorldBuilderStore();
  const categories = getAllCategories();

  if (!currentWorld) {
    return (
      <div style={{ padding: '20px', textAlign: 'center', color: '#666' }}>
        Create or load a world to start building
      </div>
    );
  }

  return (
    <div style={{ 
      flex: 1, 
      padding: '20px',
      overflowY: 'auto'
    }}>
      <h3 style={{ margin: '0 0 20px 0', color: '#4CAF50' }}>Object Palette</h3>
      
      {categories.map(category => (
        <CategorySection key={category} category={category} />
      ))}
      
      {selectedObjectId && (
        <div style={{
          marginTop: '30px',
          padding: '15px',
          backgroundColor: '#333',
          borderRadius: '5px',
          border: '1px solid #555'
        }}>
          <h4 style={{ margin: '0 0 10px 0', color: '#4CAF50' }}>Selected Object</h4>
          <ObjectProperties />
          <button
            onClick={() => removeObject(selectedObjectId)}
            style={{
              width: '100%',
              padding: '8px',
              backgroundColor: '#f44336',
              color: 'white',
              border: 'none',
              borderRadius: '3px',
              cursor: 'pointer',
              marginTop: '10px'
            }}
          >
            Delete Object
          </button>
        </div>
      )}
    </div>
  );
};

const CategorySection: React.FC<{ category: string }> = ({ category }) => {
  const objects = getObjectsByCategory(category);
  
  return (
    <div style={{ marginBottom: '25px' }}>
      <h4 style={{ 
        margin: '0 0 10px 0', 
        color: '#ccc',
        textTransform: 'capitalize',
        fontSize: '16px'
      }}>
        {category}
      </h4>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
        {objects.map(template => (
          <ObjectButton key={template.type} template={template} />
        ))}
      </div>
    </div>
  );
};

const ObjectButton: React.FC<{ template: any }> = ({ template }) => {
  const addObject = useWorldBuilderStore(state => state.addObject);
  
  const handleClick = () => {
    // Add object at origin, user can move it
    addObject(template.type as ObjectType, { x: 0, y: 0, z: 0 });
  };
  
  return (
    <button
      onClick={handleClick}
      style={{
        padding: '12px 8px',
        backgroundColor: '#444',
        color: 'white',
        border: '1px solid #666',
        borderRadius: '5px',
        cursor: 'pointer',
        fontSize: '12px',
        textAlign: 'center',
        transition: 'background-color 0.2s'
      }}
      onMouseEnter={(e) => e.currentTarget.style.backgroundColor = '#555'}
      onMouseLeave={(e) => e.currentTarget.style.backgroundColor = '#444'}
      title={template.description}
    >
      {template.name}
    </button>
  );
};

const ObjectProperties: React.FC = () => {
  const { currentWorld, selectedObjectId, updateObject } = useWorldBuilderStore();
  
  if (!currentWorld || !selectedObjectId) return null;
  
  const selectedObject = currentWorld.objects.find(obj => obj.id === selectedObjectId);
  if (!selectedObject) return null;
  
  const template = OBJECT_TEMPLATES[selectedObject.type];
  
  const updatePosition = (axis: 'x' | 'y' | 'z', value: number) => {
    updateObject(selectedObjectId, {
      position: { ...selectedObject.position, [axis]: value }
    });
  };
  
  const updateRotation = (axis: 'x' | 'y' | 'z', value: number) => {
    updateObject(selectedObjectId, {
      rotation: { ...selectedObject.rotation, [axis]: value }
    });
  };
  
  const updateScale = (axis: 'x' | 'y' | 'z', value: number) => {
    updateObject(selectedObjectId, {
      scale: { ...selectedObject.scale, [axis]: value }
    });
  };
  
  return (
    <div>
      <p style={{ margin: '0 0 10px 0', fontSize: '14px', color: '#ccc' }}>
        {template.name}
      </p>
      
      <div style={{ marginBottom: '15px' }}>
        <label style={{ display: 'block', fontSize: '12px', color: '#aaa', marginBottom: '5px' }}>
          Position
        </label>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '5px' }}>
          {(['x', 'y', 'z'] as const).map(axis => (
            <input
              key={axis}
              type="number"
              step="0.1"
              value={selectedObject.position[axis].toFixed(1)}
              onChange={(e) => updatePosition(axis, parseFloat(e.target.value) || 0)}
              style={{
                padding: '4px',
                backgroundColor: '#555',
                color: 'white',
                border: '1px solid #666',
                borderRadius: '3px',
                fontSize: '12px'
              }}
              placeholder={axis.toUpperCase()}
            />
          ))}
        </div>
      </div>
      
      <div style={{ marginBottom: '15px' }}>
        <label style={{ display: 'block', fontSize: '12px', color: '#aaa', marginBottom: '5px' }}>
          Rotation
        </label>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '5px' }}>
          {(['x', 'y', 'z'] as const).map(axis => (
            <input
              key={axis}
              type="number"
              step="0.1"
              value={(selectedObject.rotation[axis] * 180 / Math.PI).toFixed(1)}
              onChange={(e) => updateRotation(axis, (parseFloat(e.target.value) || 0) * Math.PI / 180)}
              style={{
                padding: '4px',
                backgroundColor: '#555',
                color: 'white',
                border: '1px solid #666',
                borderRadius: '3px',
                fontSize: '12px'
              }}
              placeholder={axis.toUpperCase()}
            />
          ))}
        </div>
      </div>
      
      <div style={{ marginBottom: '15px' }}>
        <label style={{ display: 'block', fontSize: '12px', color: '#aaa', marginBottom: '5px' }}>
          Scale
        </label>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '5px' }}>
          {(['x', 'y', 'z'] as const).map(axis => (
            <input
              key={axis}
              type="number"
              step="0.1"
              min="0.1"
              value={selectedObject.scale[axis].toFixed(1)}
              onChange={(e) => updateScale(axis, Math.max(0.1, parseFloat(e.target.value) || 1))}
              style={{
                padding: '4px',
                backgroundColor: '#555',
                color: 'white',
                border: '1px solid #666',
                borderRadius: '3px',
                fontSize: '12px'
              }}
              placeholder={axis.toUpperCase()}
            />
          ))}
        </div>
      </div>
      
      {selectedObject.type === 'tree-berry' && (
        <BerryTreeProperties objectId={selectedObjectId} />
      )}
    </div>
  );
};

const BerryTreeProperties: React.FC<{ objectId: string }> = ({ objectId }) => {
  const { currentWorld, updateObject } = useWorldBuilderStore();
  
  if (!currentWorld) return null;
  
  const object = currentWorld.objects.find(obj => obj.id === objectId);
  if (!object || object.type !== 'tree-berry') return null;
  
  const berryType = object.properties?.berryType || 'blueberry';
  
  const updateBerryType = (newType: string) => {
    updateObject(objectId, {
      properties: {
        ...object.properties,
        berryType: newType,
      }
    });
  };
  
  return (
    <div style={{ marginBottom: '15px' }}>
      <label style={{ display: 'block', fontSize: '12px', color: '#aaa', marginBottom: '5px' }}>
        Berry Type
      </label>
      <select
        value={berryType}
        onChange={(e) => updateBerryType(e.target.value)}
        style={{
          width: '100%',
          padding: '4px',
          backgroundColor: '#555',
          color: 'white',
          border: '1px solid #666',
          borderRadius: '3px',
          fontSize: '12px'
        }}
      >
        <option value="blueberry">Blueberry</option>
        <option value="strawberry">Strawberry</option>
        <option value="greenberry">Greenberry</option>
        <option value="goldberry">Goldberry</option>
      </select>
    </div>
  );
};

export default ObjectPalette;
