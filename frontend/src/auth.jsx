import React, { createContext, useContext, useState, useEffect } from 'react'
import { login as apiLogin } from './api'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [token, setToken] = useState(() => localStorage.getItem('token'))
  const [user, setUser] = useState(() => {
    try {
      const t = localStorage.getItem('token')
      if (!t) return null
      const payload = JSON.parse(atob(t.split('.')[1]))
      return { username: payload.username, id: payload.sub }
    } catch {
      return null
    }
  })

  const login = async (username, password) => {
    const res = await apiLogin({ username, password })
    const { access_token } = res.data
    localStorage.setItem('token', access_token)
    setToken(access_token)
    const payload = JSON.parse(atob(access_token.split('.')[1]))
    setUser({ username: payload.username, id: payload.sub })
  }

  const logout = () => {
    localStorage.removeItem('token')
    setToken(null)
    setUser(null)
  }

  return (
    <AuthContext.Provider value={{ token, user, login, logout, isAuthed: !!token }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  return useContext(AuthContext)
}
