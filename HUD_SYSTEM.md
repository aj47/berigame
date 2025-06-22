# HUD (Heads-Up Display) System

## Overview
The HUD system provides players with separate, movable, and toggleable interface components that display essential game information and quick-access functionality. It consists of two independent components: a health bar and a quick-use item bar with three slots for consumables.

## Features

### Health Bar
- **Visual Display**: Shows current health vs maximum health with a colored progress bar
- **Color Coding**: 
  - Green: Health > 60%
  - Orange: Health 30-60%
  - Red: Health < 30%
- **Numeric Display**: Shows exact health values (e.g., "25/30")

### Quick-Use Slots
- **Three Slots**: Numbered 1, 2, and 3 for easy identification
- **Berry Support**: Currently supports berry items for quick consumption
- **Drag & Drop**: Drag berries from inventory to quick-use slots
- **Visual Feedback**: 
  - Green background when item is usable
  - Gray background when health is full (item not usable)
  - Quantity indicators for stacked items
- **Auto-Sync**: Automatically updates when inventory changes

### Positioning & Visibility
- **Separate Components**: Health bar and quick-use bar can be positioned independently
- **Draggable**: Click and drag each component to reposition anywhere on screen
- **Persistent Position**: Each component's position is saved to localStorage and restored on reload
- **Toggle Visibility**: Hide/show components with keyboard shortcuts
- **Boundary Constraints**: Components stay within screen boundaries when dragged
- **Mobile Responsive**: Touch-friendly controls and responsive sizing for all screen sizes

## Controls

### Keyboard Shortcuts
- **Shift+H**: Toggle health bar visibility
- **Ctrl+H**: Toggle quick-use bar visibility
- **1, 2, 3**: Use items in quick-use slots 1, 2, and 3 respectively

### Mouse & Touch Controls
- **Click & Drag**: Move components by clicking and dragging the header area
- **Touch & Drag**: Full touch support for mobile devices
- **Click Quick-Use Slot**: Consume the item in that slot
- **Drag from Inventory**: Drag berry items from inventory to quick-use slots
- **Close Button**: Click the × button to hide each component
- **Pointer Events**: Uses modern pointer events for cross-platform compatibility

## Technical Implementation

### Components
- **`HealthBar.tsx`**: Standalone health bar component with drag/drop support
- **`QuickUseBar.tsx`**: Standalone quick-use bar component with three slots
- **`QuickUseSlot.tsx`**: Individual quick-use slot component with drag/drop support

### State Management
- **`useHealthBarStore`**: Zustand store managing health bar state
  - `isVisible`: Health bar visibility state
  - `position`: Health bar screen position (x, y coordinates)
  - `isDragging`: Drag state for UI feedback
- **`useQuickUseBarStore`**: Zustand store managing quick-use bar state
  - `isVisible`: Quick-use bar visibility state
  - `position`: Quick-use bar screen position (x, y coordinates)
  - `quickUseSlots`: Array of three item slots
  - `isDragging`: Drag state for UI feedback

### Key Functions
```javascript
// Health Bar Functions
useHealthBarStore.getState().toggleVisibility()
useHealthBarStore.getState().setPosition({ x: 100, y: 50 })

// Quick Use Bar Functions
useQuickUseBarStore.getState().toggleVisibility()
useQuickUseBarStore.getState().setPosition({ x: 100, y: 150 })
useQuickUseBarStore.getState().setQuickUseSlot(slotIndex, item)
useQuickUseBarStore.getState().clearQuickUseSlot(slotIndex)
```

### Integration Points
- **Inventory System**: Drag & drop integration for item assignment
- **Health System**: Real-time health display from `useUserStateStore`
- **Berry Consumption**: Reuses existing berry consumption logic
- **Chat System**: Respects chat focus state for keyboard shortcuts

## Styling

### CSS Classes
- `.health-bar-container`: Health bar container with backdrop blur effect
- `.health-bar-header`: Health bar header area with title and close button
- `.health-bar-toggle-button`: Show health bar button when hidden
- `.quick-use-bar-container`: Quick-use bar container with backdrop blur effect
- `.quick-use-bar-header`: Quick-use bar header area with title and close button
- `.quick-use-bar-toggle-button`: Show quick-use bar button when hidden
- `.quick-use-slot`: Individual quick-use slot styling

### Visual Design
- **Dark Theme**: Semi-transparent black background with blur effect
- **Rounded Corners**: Modern UI with 8px border radius
- **Hover Effects**: Subtle animations and color changes
- **Mobile Responsive**: Adapts to different screen sizes with media queries
- **Touch-Friendly**: Larger touch targets on mobile devices (44px minimum)
- **Cross-Platform**: Uses pointer events for mouse, touch, and stylus support

## Usage Examples

### Basic Usage
1. **View Health**: Health bar is always visible when HUD is shown
2. **Add Quick Items**: Drag berries from inventory to quick-use slots
3. **Use Items**: Click slots or press 1/2/3 keys to consume items
4. **Reposition**: Drag HUD to preferred screen location
5. **Toggle**: Press 'H' to hide/show HUD

### Advanced Features
- **Persistent Setup**: Components remember positions between game sessions
- **Inventory Sync**: Quick-use slots automatically update when items are consumed elsewhere
- **Keyboard Efficiency**: Use number keys for rapid item consumption during combat
- **Independent Positioning**: Health bar and quick-use bar can be positioned separately
- **Mobile Optimization**: Responsive design with touch-friendly controls

## Mobile Responsiveness

### Screen Size Adaptations
- **Tablets (≤768px)**: Reduced component sizes and padding
- **Phones (≤480px)**: Further size reductions for optimal mobile experience
- **Touch Devices**: Minimum 44px touch targets for accessibility

### Mobile-Specific Features
- **Touch Drag**: Full touch support for repositioning components
- **Pointer Events**: Modern event handling for all input types
- **Responsive Sizing**: Components scale appropriately on different screen sizes
- **Touch-Friendly Buttons**: Larger buttons and touch targets on mobile
- **Optimized Layout**: Compact design that doesn't obstruct gameplay

### CSS Media Queries
```css
@media (max-width: 768px) {
  /* Tablet optimizations */
}

@media (max-width: 480px) {
  /* Phone optimizations */
}

@media (hover: none) and (pointer: coarse) {
  /* Touch device optimizations */
}
```

## Testing

### Unit Tests (`hud.test.js`)
- HUD store initialization and state management
- Visibility toggling functionality
- Position setting and persistence
- Quick-use slot assignment and clearing
- Multiple slot independence

### Manual Testing
1. **Drag Functionality**: Verify HUD can be moved around screen
2. **Keyboard Shortcuts**: Test H key toggle and 1/2/3 consumption
3. **Inventory Integration**: Test drag & drop from inventory
4. **Health Display**: Verify health bar updates correctly
5. **Persistence**: Check position saves/loads on page refresh

## Future Enhancements

### Potential Features
- **Customizable Slots**: Allow more than 3 quick-use slots
- **Item Types**: Support for other consumable items beyond berries
- **Hotkey Customization**: Allow players to rebind keyboard shortcuts
- **HUD Themes**: Multiple visual themes and transparency options
- **Minimap Integration**: Add minimap to HUD
- **Status Effects**: Display active buffs/debuffs
- **Resource Bars**: Mana, stamina, or other resource tracking

### Technical Improvements
- **Performance**: Optimize re-renders with React.memo
- **Accessibility**: Add ARIA labels and keyboard navigation
- **Mobile Support**: Touch-friendly controls for mobile devices
- **Animation**: Smooth transitions for show/hide and slot updates

## Configuration

### Default Settings
- **Position**: Top-left corner (20px, 20px)
- **Visibility**: Visible by default
- **Quick-Use Slots**: 3 empty slots
- **Health Bar**: Shows current/max health with color coding

### Customization
Position and visibility preferences are automatically saved to browser localStorage and restored on subsequent visits.
