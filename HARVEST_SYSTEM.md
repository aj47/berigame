# Harvest System Documentation

## Overview

The harvest system allows players to collect berries from trees in the game world. This document outlines the implementation details and usage of the harvest functionality.

## Features

### Core Functionality
- **Interactive Harvesting**: Players can click on berry trees to initiate harvest
- **Random Duration**: Each harvest takes 3-10 seconds (randomized server-side)
- **Visual Progress**: Real-time progress bar with percentage indicator
- **Inventory Integration**: Harvested berries are automatically added to player inventory
- **Cooldown System**: Trees have a 30-second cooldown after being harvested

### User Interface
- **Progress Indicator**: Floating UI element above trees during harvest
- **Inventory Display**: Press 'I' or click "Inventory" button to view collected items
- **Visual Feedback**: Trees show different states (harvestable/harvesting/cooldown)
- **Disabled Actions**: Harvest option is disabled during active harvesting

## Technical Architecture

### State Management
- **useHarvestStore**: Manages active harvests, tree states, and cooldowns
- **useInventoryStore**: Handles player inventory items and operations

### Backend Integration
- **WebSocket Routes**: `startHarvest` and `completeHarvest` for real-time communication
- **Database Storage**: Harvest progress and inventory stored in DynamoDB
- **Server Validation**: Harvest timing and completion handled server-side

### Components
- **BerryTree**: Main harvest interaction component with progress UI
- **Inventory**: Enhanced inventory display with actual items
- **ClickDropdown**: Updated to support disabled harvest actions

## Usage

### For Players
1. **Find a Tree**: Look for berry trees in the game world
2. **Start Harvest**: Click on a tree and select "Harvest" from the dropdown
3. **Wait for Completion**: Watch the progress bar fill over 3-10 seconds
4. **Check Inventory**: Press 'I' to see your collected berries
5. **Cooldown**: Wait 30 seconds before harvesting the same tree again

### For Developers
```javascript
// Start a harvest
const { startHarvest } = useHarvestStore.getState()
startHarvest(treeId, playerId, duration)

// Check if tree is harvestable
const { isTreeHarvestable } = useHarvestStore.getState()
const canHarvest = isTreeHarvestable(treeId)

// Add item to inventory
const { addItem } = useInventoryStore.getState()
addItem({ type: 'berry', name: 'Berry', quantity: 1 })
```

## Testing

Run the test suite to verify harvest functionality:
```bash
cd frontend
npm test
```

Tests cover:
- Harvest state management
- Inventory operations
- Tree harvestability checks
- Progress calculation
- Item management

## Configuration

### Harvest Timing
- **Minimum Duration**: 3 seconds
- **Maximum Duration**: 10 seconds
- **Cooldown Period**: 30 seconds

### Tree States
- **Harvestable**: Tree can be harvested
- **Harvesting**: Harvest in progress
- **Cooldown**: Recently harvested, waiting for respawn

## Future Enhancements

- **Multiple Tree Types**: Different trees with varying harvest times and rewards
- **Harvest Animations**: Player character animations during harvesting
- **Sound Effects**: Audio feedback for harvest actions
- **Achievement System**: Track harvest statistics and milestones
- **Seasonal Variations**: Different harvest rates based on game time

## Troubleshooting

### Common Issues
1. **Harvest Not Starting**: Check WebSocket connection and tree state
2. **Progress Not Updating**: Verify harvest store updates and component re-renders
3. **Items Not Appearing**: Check inventory store and item addition logic
4. **Cooldown Not Working**: Verify tree state management and timing

### Debug Commands
```javascript
// Check harvest store state
console.log(useHarvestStore.getState())

// Check inventory state
console.log(useInventoryStore.getState())

// Check active harvests
console.log(useHarvestStore.getState().activeHarvests)
```

## API Reference

### Harvest Store Methods
- `startHarvest(treeId, playerId, duration)`: Begin harvest process
- `completeHarvest(treeId)`: Complete harvest and apply cooldown
- `cancelHarvest(treeId)`: Cancel active harvest
- `getHarvestProgress(treeId)`: Get current harvest progress
- `isTreeHarvestable(treeId)`: Check if tree can be harvested

### Inventory Store Methods
- `addItem(item)`: Add item to inventory
- `removeItem(itemId)`: Remove item from inventory
- `getItemCount(itemType)`: Count items of specific type

### WebSocket Messages
- `startHarvest`: Initiate harvest on server
- `completeHarvest`: Complete harvest and update inventory
- `harvestStarted`: Broadcast harvest start to all players
- `harvestCompleted`: Broadcast harvest completion to all players
