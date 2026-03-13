import express from 'express';
import { requireAdmin, requireAuth } from './auth.js';


export const adminRouter = express.Router();

adminRouter.get('/login', (req, res) => {
  res.send(`
    <html><body>
      <h2>Enterprise Login</h2>
      <form method="POST" action="/admin/login">
        Email: <input name="email" type="text" /><br/>
        Password: <input name="password" type="password" /> (hint: enter 'enterprise' for Admin, 'user' for Viewer)<br/>
        <button type="submit">Login</button>
      </form>
    </body></html>
  `);
});

adminRouter.get('/', requireAuth, (req, res) => {
  const user = req.user as any;
  res.send(`
    <html><body>
      <h2>Dashboard</h2>
      <p>Welcome, ${user.email} (Role: ${user.role})</p>
      ${user.role === 'Admin' ? '<a href="/admin/users">Manage Users</a> <br/> <a href="/admin/audit">Audit Logs</a>' : ''}
      <form method="POST" action="/admin/logout">
        <button type="submit">Logout</button>
      </form>
    </body></html>
  `);
});

adminRouter.get('/users', requireAdmin, (req, res) => {
  res.send('User management stub');
});


