import { auth } from './Auth'

let url = "https://rmwrulu837.execute-api.ap-southeast-2.amazonaws.com/dev/"
let wsUrl = "wss://ahftzn2xw8.execute-api.ap-southeast-2.amazonaws.com/dev/"
if (process.env.NODE_ENV === 'development')  {
  url = "http://localhost:3000/dev/";
  wsUrl = "ws://localhost:3001";
}
const connectedUsers = {};

export const webSocketConnection = new WebSocket(wsUrl);

// Might be used in future for messaging user directly 
// for notification or something
const _webSocketOpen = (e: Event) => {
  connectToChatRoom("");
}

const defaultHeaders = {
  'Accept': 'application/json',
  'Content-Type': 'application/json',
  'Authorization': ""
}

export const serverPOST = async (endpoint: string, inputData: any, withToken=true) => {
  let headers = defaultHeaders;
  if (withToken && defaultHeaders.Authorization === "") 
    headers.Authorization = await auth.getToken() || "";

  const fetchData = await fetch(url+endpoint, {
    headers,
    method: 'POST',
    body: JSON.stringify(inputData)
  }).catch(e => {
    console.log("serverPOST error", e);
  });
  const JSONData = await fetchData.json();
  JSONData.status = fetchData.status;
  return JSONData;
}

export const serverGET = async (endpoint: string, withToken=true) => {
  let headers = defaultHeaders;
  if (withToken && defaultHeaders.Authorization === "") 
    headers.Authorization = await auth.getToken() || "";
  return await fetch(url+endpoint, {
    headers,
    method: 'GET',
  })
}


export const webSocketConnect = () => {
  webSocketConnection.onerror = _webSocketError;
  webSocketConnection.onclose = _webSocketClose;
  webSocketConnection.onopen = _webSocketOpen;
  webSocketConnection.onmessage = _webSocketMessageReceived;
}

export const webSocketSaveConnection = async () => {
  try {
    const token = await auth.getToken();
    if (token) {
      const payload = {
        token,
        action: "saveConnection",
      }
      webSocketConnection?.send(JSON.stringify(payload));
    }
  } catch (e) {
    console.error("webSocketSaveConnection Error:", e);
  }
}

export const webSocketSendPosition = async (message: string) => {
  try {
    const token = await auth.getToken();
    const payload = {
      token,
      message,
      chatRoomId: "CHATROOM#913a9780-ff43-11eb-aa45-277d189232f4", //The one chatroom for MVP
      action: "sendPosition",
    }
    webSocketConnection?.send(JSON.stringify(payload));
  } catch (e) {
    console.error("webSocketSendMessage Error:", e);
    setTimeout(() => {
      webSocketSendPosition(message);
    }, 500);
  }
}

export const webSocketSendMessage = async (message: string) => {
  try {
    const token = await auth.getToken();
    const payload = {
      token,
      message,
      chatRoomId: "CHATROOM#913a9780-ff43-11eb-aa45-277d189232f4", //The one chatroom for MVP
      action: "sendMessagePublic",
    }
    webSocketConnection?.send(JSON.stringify(payload));
  } catch (e) {
    console.error("webSocketSendMessage Error:", e);
  }
}

export const connectToChatRoom = async (chatRoomId: string) => {
  try {
    const token = await auth.getToken();
    const payload = {
      token,
      chatRoomId: "CHATROOM#913a9780-ff43-11eb-aa45-277d189232f4", //The one chatroom for MVP
      action: "connectToChatRoom",
    }
    webSocketConnection?.send(JSON.stringify(payload));
  } catch (e) {
    console.error("webSocketSaveConnection Error:", e);
    setTimeout(() => {
      connectToChatRoom(chatRoomId);
    }, 500);
  }
}

const _webSocketMessageReceived = (e) => {
  if (e.data) {
    const messageObject = JSON.parse(e.data);
    if (messageObject.position && messageObject.userId) {
      updateUserPosition(messageObject);
    }
  }
}

const _webSocketError = (e: Event) => {
  console.error("Websocket error:", e);
}

const _webSocketClose = (e: Event) => {
  console.log("Websocket close:", e);
}

const updateUserPosition = (newData) => {
  connectedUsers[newData.userId] = newData;
}

export const getUserPositions = () => {
  return connectedUsers;
}