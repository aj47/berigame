import { describe, it, expect, beforeEach } from 'vitest'
import { useHealthBarStore, useQuickUseBarStore } from '../store'

describe('Health Bar Store', () => {
  beforeEach(() => {
    useHealthBarStore.setState({
      isVisible: true,
      position: { x: 20, y: 20 },
      isDragging: false,
    })
  })

  it('should initialize with default values', () => {
    const state = useHealthBarStore.getState()
    expect(state.isVisible).toBe(true)
    expect(state.position).toEqual({ x: 20, y: 20 })
    expect(state.isDragging).toBe(false)
  })

  it('should toggle visibility', () => {
    const { toggleVisibility } = useHealthBarStore.getState()

    toggleVisibility()
    expect(useHealthBarStore.getState().isVisible).toBe(false)

    toggleVisibility()
    expect(useHealthBarStore.getState().isVisible).toBe(true)
  })

  it('should set visibility directly', () => {
    const { setVisible } = useHealthBarStore.getState()

    setVisible(false)
    expect(useHealthBarStore.getState().isVisible).toBe(false)

    setVisible(true)
    expect(useHealthBarStore.getState().isVisible).toBe(true)
  })

  it('should update position', () => {
    const { setPosition } = useHealthBarStore.getState()
    const newPosition = { x: 100, y: 200 }

    setPosition(newPosition)
    expect(useHealthBarStore.getState().position).toEqual(newPosition)
  })

  it('should set dragging state', () => {
    const { setDragging } = useHealthBarStore.getState()

    setDragging(true)
    expect(useHealthBarStore.getState().isDragging).toBe(true)

    setDragging(false)
    expect(useHealthBarStore.getState().isDragging).toBe(false)
  })
})

describe('Quick Use Bar Store', () => {
  beforeEach(() => {
    useQuickUseBarStore.setState({
      isVisible: true,
      position: { x: 20, y: 80 },
      quickUseSlots: [null, null, null],
      isDragging: false,
    })
  })

  it('should initialize with default values', () => {
    const state = useQuickUseBarStore.getState()
    expect(state.isVisible).toBe(true)
    expect(state.position).toEqual({ x: 20, y: 80 })
    expect(state.quickUseSlots).toEqual([null, null, null])
    expect(state.isDragging).toBe(false)
  })

  it('should toggle visibility', () => {
    const { toggleVisibility } = useQuickUseBarStore.getState()

    toggleVisibility()
    expect(useQuickUseBarStore.getState().isVisible).toBe(false)

    toggleVisibility()
    expect(useQuickUseBarStore.getState().isVisible).toBe(true)
  })

  it('should set visibility directly', () => {
    const { setVisible } = useQuickUseBarStore.getState()

    setVisible(false)
    expect(useQuickUseBarStore.getState().isVisible).toBe(false)

    setVisible(true)
    expect(useQuickUseBarStore.getState().isVisible).toBe(true)
  })

  it('should update position', () => {
    const { setPosition } = useQuickUseBarStore.getState()
    const newPosition = { x: 100, y: 200 }

    setPosition(newPosition)
    expect(useQuickUseBarStore.getState().position).toEqual(newPosition)
  })

  it('should set quick use slot items', () => {
    const { setQuickUseSlot } = useQuickUseBarStore.getState()
    const testItem = {
      type: 'berry',
      subType: 'blueberry',
      name: 'Blueberry',
      quantity: 1,
      id: 'test-id'
    }

    setQuickUseSlot(0, testItem)
    const state = useQuickUseBarStore.getState()
    expect(state.quickUseSlots[0]).toEqual(testItem)
    expect(state.quickUseSlots[1]).toBe(null)
    expect(state.quickUseSlots[2]).toBe(null)
  })

  it('should clear quick use slot', () => {
    const { setQuickUseSlot, clearQuickUseSlot } = useQuickUseBarStore.getState()
    const testItem = {
      type: 'berry',
      subType: 'blueberry',
      name: 'Blueberry',
      quantity: 1,
      id: 'test-id'
    }

    // Set item first
    setQuickUseSlot(1, testItem)
    expect(useQuickUseBarStore.getState().quickUseSlots[1]).toEqual(testItem)

    // Clear it
    clearQuickUseSlot(1)
    expect(useQuickUseBarStore.getState().quickUseSlots[1]).toBe(null)
  })

  it('should handle multiple quick use slots independently', () => {
    const { setQuickUseSlot } = useQuickUseBarStore.getState()
    const item1 = { type: 'berry', subType: 'blueberry', name: 'Blueberry', id: '1' }
    const item2 = { type: 'berry', subType: 'strawberry', name: 'Strawberry', id: '2' }
    const item3 = { type: 'berry', subType: 'greenberry', name: 'Greenberry', id: '3' }

    setQuickUseSlot(0, item1)
    setQuickUseSlot(1, item2)
    setQuickUseSlot(2, item3)

    const state = useQuickUseBarStore.getState()
    expect(state.quickUseSlots[0]).toEqual(item1)
    expect(state.quickUseSlots[1]).toEqual(item2)
    expect(state.quickUseSlots[2]).toEqual(item3)
  })

  it('should set dragging state', () => {
    const { setDragging } = useQuickUseBarStore.getState()

    setDragging(true)
    expect(useQuickUseBarStore.getState().isDragging).toBe(true)

    setDragging(false)
    expect(useQuickUseBarStore.getState().isDragging).toBe(false)
  })
})
