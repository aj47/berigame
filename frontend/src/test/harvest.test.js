import { describe, it, expect, beforeEach } from 'vitest'
import { useHarvestStore, useInventoryStore } from '../store'

describe('Harvest Store', () => {
  beforeEach(() => {
    // Reset stores before each test
    useHarvestStore.setState({
      activeHarvests: {},
      treeStates: {},
    })
    useInventoryStore.setState({
      items: [],
    })
  })

  it('should start a harvest', () => {
    const { startHarvest } = useHarvestStore.getState()
    
    startHarvest('tree1', 'player1', 5)
    
    const state = useHarvestStore.getState()
    expect(state.activeHarvests['tree1']).toBeDefined()
    expect(state.activeHarvests['tree1'].playerId).toBe('player1')
    expect(state.activeHarvests['tree1'].duration).toBe(5000) // converted to milliseconds
  })

  it('should complete a harvest', () => {
    const { startHarvest, completeHarvest } = useHarvestStore.getState()
    
    // Start harvest first
    startHarvest('tree1', 'player1', 5)
    
    // Complete harvest
    completeHarvest('tree1')
    
    const state = useHarvestStore.getState()
    expect(state.activeHarvests['tree1']).toBeUndefined()
    expect(state.treeStates['tree1']).toBeDefined()
    expect(state.treeStates['tree1'].isHarvestable).toBe(false)
  })

  it('should check if tree is harvestable', () => {
    const { isTreeHarvestable } = useHarvestStore.getState()
    
    // New tree should be harvestable
    expect(isTreeHarvestable('tree1')(useHarvestStore.getState())).toBe(true)
    
    // Tree with active harvest should not be harvestable
    useHarvestStore.getState().startHarvest('tree1', 'player1', 5)
    expect(isTreeHarvestable('tree1')(useHarvestStore.getState())).toBe(false)
  })
})

describe('Inventory Store', () => {
  beforeEach(() => {
    useInventoryStore.setState({
      items: [],
    })
  })

  it('should add items to inventory', () => {
    const { addItem } = useInventoryStore.getState()
    
    addItem({
      type: 'berry',
      name: 'Berry',
      quantity: 1,
    })
    
    const state = useInventoryStore.getState()
    expect(state.items).toHaveLength(1)
    expect(state.items[0].type).toBe('berry')
    expect(state.items[0].name).toBe('Berry')
  })

  it('should remove items from inventory', () => {
    const { addItem, removeItem } = useInventoryStore.getState()
    
    // Add item first
    addItem({
      type: 'berry',
      name: 'Berry',
      quantity: 1,
    })
    
    const state = useInventoryStore.getState()
    const itemId = state.items[0].id
    
    // Remove item
    removeItem(itemId)
    
    const newState = useInventoryStore.getState()
    expect(newState.items).toHaveLength(0)
  })
})
