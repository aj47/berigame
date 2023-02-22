export const auth =  {
  isAuthenticated: null,
  jwtToken: null,
  async getToken() {
    if (this.jwtToken)
      return this.jwtToken;
    else
      this.jwtToken = await window.localStorage.getItem('cubespacedapi');
      return this.jwtToken;
  },
  async setToken(token) {
    window.localStorage.setItem('cubespacedapi', token);
  },
  removeToken() {
    window.localStorage.removeItem('cubespacedapi');
}
}
