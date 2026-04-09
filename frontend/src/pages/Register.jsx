import React, { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { register } from '../api'

export default function Register() {
  const navigate = useNavigate()
  const [form, setForm] = useState({
    name: '',
    email: '',
    username: '',
    password: '',
    confirm_password: '',
    accept_terms: false,
  })
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const onChange = (e) => {
    const { name, value, type, checked } = e.target
    setForm({ ...form, [name]: type === 'checkbox' ? checked : value })
  }

  const onSubmit = async (e) => {
    e.preventDefault()
    setError('')
    if (form.password !== form.confirm_password) {
      setError('Passwords do not match')
      return
    }
    if (!form.accept_terms) {
      setError('You must accept the Terms of Service and Privacy Policy')
      return
    }
    setLoading(true)
    try {
      await register(form)
      navigate('/login')
    } catch (err) {
      const detail = err.response?.data?.detail
      setError(typeof detail === 'string' ? detail : 'Registration failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <Link to="/" className="text-mesh-accent font-bold text-xl tracking-wider">MeshEngine</Link>
          <p className="text-mesh-muted text-sm mt-2">Create your account</p>
        </div>

        <form onSubmit={onSubmit} className="card space-y-4">
          {error && (
            <div className="bg-red-900/30 border border-red-800 rounded px-3 py-2 text-mesh-red text-sm">
              {error}
            </div>
          )}

          {[
            { name: 'name',     label: 'Full Name',  type: 'text',     placeholder: 'Alice Smith' },
            { name: 'email',    label: 'Email',       type: 'email',    placeholder: 'alice@example.com' },
            { name: 'username', label: 'Username',    type: 'text',     placeholder: 'alice' },
            { name: 'password', label: 'Password',    type: 'password', placeholder: '••••••••' },
            { name: 'confirm_password', label: 'Confirm Password', type: 'password', placeholder: '••••••••' },
          ].map(({ name, label, type, placeholder }) => (
            <div key={name}>
              <label className="label">{label}</label>
              <input
                name={name}
                type={type}
                value={form[name]}
                onChange={onChange}
                required
                className="input"
                placeholder={placeholder}
              />
            </div>
          ))}

          <label className="flex items-start gap-3 cursor-pointer">
            <input
              name="accept_terms"
              type="checkbox"
              checked={form.accept_terms}
              onChange={onChange}
              className="mt-0.5 accent-mesh-accent"
            />
            <span className="text-xs text-mesh-muted leading-relaxed">
              I agree to the{' '}
              <span className="text-mesh-accent">Terms of Service</span> and{' '}
              <span className="text-mesh-accent">Privacy Policy</span>
            </span>
          </label>

          <button
            type="submit"
            disabled={loading}
            className="btn-primary w-full justify-center py-2.5 disabled:opacity-50"
          >
            {loading ? 'Creating account…' : 'Create Account'}
          </button>
        </form>

        <p className="text-center text-mesh-muted text-sm mt-4">
          Already have an account?{' '}
          <Link to="/login" className="text-mesh-accent hover:underline">
            Sign in
          </Link>
        </p>
      </div>
    </div>
  )
}
