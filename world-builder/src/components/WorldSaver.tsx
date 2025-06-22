import React, { useState } from 'react';
import { useWorldBuilderStore } from '../store/worldBuilderStore';
import { exportWorldToFile, importWorldFromFile, getSavedWorlds, deleteSavedWorld } from '../utils/worldExporter';

const WorldSaver: React.FC = () => {
  const { 
    currentWorld, 
    createNewWorld, 
    saveWorld, 
    loadWorld, 
    exportWorld, 
    importWorld 
  } = useWorldBuilderStore();
  
  const [showNewWorldDialog, setShowNewWorldDialog] = useState(false);
  const [showLoadDialog, setShowLoadDialog] = useState(false);
  const [newWorldName, setNewWorldName] = useState('');
  const [newWorldDescription, setNewWorldDescription] = useState('');

  const handleCreateNew = () => {
    if (newWorldName.trim()) {
      createNewWorld(newWorldName.trim(), newWorldDescription.trim());
      setNewWorldName('');
      setNewWorldDescription('');
      setShowNewWorldDialog(false);
    }
  };

  const handleSave = () => {
    if (currentWorld) {
      saveWorld();
      alert('World saved successfully!');
    }
  };

  const handleExport = () => {
    if (currentWorld) {
      exportWorldToFile(currentWorld);
    }
  };

  const handleImport = async () => {
    const world = await importWorldFromFile();
    if (world) {
      loadWorld(world);
      alert('World imported successfully!');
    } else {
      alert('Failed to import world. Please check the file format.');
    }
  };

  return (
    <div style={{ 
      padding: '20px',
      borderBottom: '1px solid #444'
    }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
        <button
          onClick={() => setShowNewWorldDialog(true)}
          style={{
            padding: '10px',
            backgroundColor: '#4CAF50',
            color: 'white',
            border: 'none',
            borderRadius: '5px',
            cursor: 'pointer',
            fontSize: '14px'
          }}
        >
          New World
        </button>
        
        <button
          onClick={() => setShowLoadDialog(true)}
          style={{
            padding: '10px',
            backgroundColor: '#2196F3',
            color: 'white',
            border: 'none',
            borderRadius: '5px',
            cursor: 'pointer',
            fontSize: '14px'
          }}
        >
          Load World
        </button>
        
        {currentWorld && (
          <>
            <button
              onClick={handleSave}
              style={{
                padding: '10px',
                backgroundColor: '#FF9800',
                color: 'white',
                border: 'none',
                borderRadius: '5px',
                cursor: 'pointer',
                fontSize: '14px'
              }}
            >
              Save World
            </button>
            
            <div style={{ display: 'flex', gap: '5px' }}>
              <button
                onClick={handleExport}
                style={{
                  flex: 1,
                  padding: '8px',
                  backgroundColor: '#9C27B0',
                  color: 'white',
                  border: 'none',
                  borderRadius: '5px',
                  cursor: 'pointer',
                  fontSize: '12px'
                }}
              >
                Export
              </button>
              
              <button
                onClick={handleImport}
                style={{
                  flex: 1,
                  padding: '8px',
                  backgroundColor: '#607D8B',
                  color: 'white',
                  border: 'none',
                  borderRadius: '5px',
                  cursor: 'pointer',
                  fontSize: '12px'
                }}
              >
                Import
              </button>
            </div>
          </>
        )}
      </div>

      {/* New World Dialog */}
      {showNewWorldDialog && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: 'rgba(0,0,0,0.8)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 10000
        }}>
          <div style={{
            backgroundColor: '#333',
            padding: '30px',
            borderRadius: '10px',
            border: '1px solid #555',
            minWidth: '400px'
          }}>
            <h3 style={{ margin: '0 0 20px 0', color: '#4CAF50' }}>Create New World</h3>
            
            <div style={{ marginBottom: '15px' }}>
              <label style={{ display: 'block', marginBottom: '5px', color: '#ccc' }}>
                World Name *
              </label>
              <input
                type="text"
                value={newWorldName}
                onChange={(e) => setNewWorldName(e.target.value)}
                style={{
                  width: '100%',
                  padding: '10px',
                  backgroundColor: '#555',
                  color: 'white',
                  border: '1px solid #666',
                  borderRadius: '5px',
                  fontSize: '14px'
                }}
                placeholder="Enter world name"
                autoFocus
              />
            </div>
            
            <div style={{ marginBottom: '20px' }}>
              <label style={{ display: 'block', marginBottom: '5px', color: '#ccc' }}>
                Description
              </label>
              <textarea
                value={newWorldDescription}
                onChange={(e) => setNewWorldDescription(e.target.value)}
                style={{
                  width: '100%',
                  height: '80px',
                  padding: '10px',
                  backgroundColor: '#555',
                  color: 'white',
                  border: '1px solid #666',
                  borderRadius: '5px',
                  fontSize: '14px',
                  resize: 'vertical'
                }}
                placeholder="Optional description"
              />
            </div>
            
            <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
              <button
                onClick={() => setShowNewWorldDialog(false)}
                style={{
                  padding: '10px 20px',
                  backgroundColor: '#666',
                  color: 'white',
                  border: 'none',
                  borderRadius: '5px',
                  cursor: 'pointer'
                }}
              >
                Cancel
              </button>
              <button
                onClick={handleCreateNew}
                disabled={!newWorldName.trim()}
                style={{
                  padding: '10px 20px',
                  backgroundColor: newWorldName.trim() ? '#4CAF50' : '#444',
                  color: 'white',
                  border: 'none',
                  borderRadius: '5px',
                  cursor: newWorldName.trim() ? 'pointer' : 'not-allowed'
                }}
              >
                Create
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Load World Dialog */}
      {showLoadDialog && (
        <LoadWorldDialog onClose={() => setShowLoadDialog(false)} />
      )}
    </div>
  );
};

const LoadWorldDialog: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const { loadWorld } = useWorldBuilderStore();
  const [savedWorlds, setSavedWorlds] = useState(getSavedWorlds());

  const handleLoad = (world: any) => {
    loadWorld(world);
    onClose();
  };

  const handleDelete = (worldId: string) => {
    if (confirm('Are you sure you want to delete this world?')) {
      deleteSavedWorld(worldId);
      setSavedWorlds(getSavedWorlds());
    }
  };

  return (
    <div style={{
      position: 'fixed',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      backgroundColor: 'rgba(0,0,0,0.8)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 10000
    }}>
      <div style={{
        backgroundColor: '#333',
        padding: '30px',
        borderRadius: '10px',
        border: '1px solid #555',
        minWidth: '500px',
        maxHeight: '70vh',
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column'
      }}>
        <h3 style={{ margin: '0 0 20px 0', color: '#4CAF50' }}>Load World</h3>
        
        <div style={{ flex: 1, overflowY: 'auto', marginBottom: '20px' }}>
          {savedWorlds.length === 0 ? (
            <p style={{ color: '#666', textAlign: 'center', padding: '20px' }}>
              No saved worlds found
            </p>
          ) : (
            savedWorlds.map(world => (
              <div key={world.id} style={{
                padding: '15px',
                backgroundColor: '#444',
                borderRadius: '5px',
                marginBottom: '10px',
                border: '1px solid #555'
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <div style={{ flex: 1 }}>
                    <h4 style={{ margin: '0 0 5px 0', color: '#fff' }}>{world.name}</h4>
                    {world.description && (
                      <p style={{ margin: '0 0 10px 0', color: '#ccc', fontSize: '14px' }}>
                        {world.description}
                      </p>
                    )}
                    <p style={{ margin: 0, color: '#888', fontSize: '12px' }}>
                      {world.objects.length} objects • Modified: {new Date(world.modified).toLocaleDateString()}
                    </p>
                  </div>
                  <div style={{ display: 'flex', gap: '5px', marginLeft: '10px' }}>
                    <button
                      onClick={() => handleLoad(world)}
                      style={{
                        padding: '5px 10px',
                        backgroundColor: '#4CAF50',
                        color: 'white',
                        border: 'none',
                        borderRadius: '3px',
                        cursor: 'pointer',
                        fontSize: '12px'
                      }}
                    >
                      Load
                    </button>
                    <button
                      onClick={() => handleDelete(world.id)}
                      style={{
                        padding: '5px 10px',
                        backgroundColor: '#f44336',
                        color: 'white',
                        border: 'none',
                        borderRadius: '3px',
                        cursor: 'pointer',
                        fontSize: '12px'
                      }}
                    >
                      Delete
                    </button>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
        
        <button
          onClick={onClose}
          style={{
            padding: '10px 20px',
            backgroundColor: '#666',
            color: 'white',
            border: 'none',
            borderRadius: '5px',
            cursor: 'pointer'
          }}
        >
          Close
        </button>
      </div>
    </div>
  );
};

export default WorldSaver;
