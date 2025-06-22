export const auth = {
  isAuthenticated: null,
  jwtToken: null,

  async getToken() {
    if (this.jwtToken) {
      return this.jwtToken;
    } else {
      this.jwtToken = await window.localStorage.getItem('berigame-auth-token');
      return this.jwtToken;
    }
  },

  async setToken(token: string) {
    this.jwtToken = token;
    window.localStorage.setItem('berigame-auth-token', token);
  },

  removeToken() {
    this.jwtToken = null;
    window.localStorage.removeItem('berigame-auth-token');
  },

  async isLoggedIn() {
    const token = await this.getToken();
    return !!token;
  }
}
