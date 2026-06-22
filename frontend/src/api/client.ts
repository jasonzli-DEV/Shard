import axios from 'axios';

const client = axios.create({
  baseURL: '/api',
  withCredentials: true,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Normalize error responses so callers get a consistent shape
client.interceptors.response.use(
  (response) => response,
  (error) => {
    const message: string =
      error.response?.data?.error ?? error.message ?? 'Unknown error';
    return Promise.reject(new Error(message));
  },
);

export default client;
