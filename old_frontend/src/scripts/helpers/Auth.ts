export const auth =  {
  isAuthenticated: null,
  jwtToken: null,
  async getToken() {
    if (this.jwtToken)
      return this.jwtToken;
    else
      this.jwtToken = await window.localStorage.getItem('chatchatboxapi');
      return this.jwtToken;
  },
  async setToken(token) {
    window.localStorage.setItem('chatchatboxapi', token);
  },
  removeToken() {
    window.localStorage.removeItem('chatchatboxapi');
  }
}
