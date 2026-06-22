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
    const status: number | undefined = error.response?.status;
    const err = new Error(message) as Error & { status?: number };
    if (status !== undefined) err.status = status;
    return Promise.reject(err);
  },
);

export default client;
