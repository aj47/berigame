import React, { memo } from 'react';
import ChatBox from './ChatBox';
import Inventory from './Inventory';
import StanceHud from './StanceHud';
import Toast from './Toast';
import TickDebug from './TickDebug';

const UIComponents = memo(() => (
  <div className="ui-group">
    <ChatBox />
    <Inventory />
    <StanceHud />
    <Toast />
    <TickDebug />
  </div>
));

export default UIComponents;
