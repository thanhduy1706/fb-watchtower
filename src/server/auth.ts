import passport from 'passport';
import { Strategy as LocalStrategy } from 'passport-local';
import express, { Request, Response, NextFunction } from 'express';
import session from 'express-session';



export function configureAuth(app: express.Application) {
  app.use(session({
    secret: process.env.SESSION_SECRET || 'fallback-secret',
    resave: false,
    saveUninitialized: false,
    cookie: {
      maxAge: 7 * 24 * 60 * 60 * 1000 
    }
  }));

  app.use(passport.initialize());
  app.use(passport.session());

  passport.use(new LocalStrategy(
    { usernameField: 'email' },
    async (email, password, done) => {
      
      
      if (password === 'enterprise') {
        return done(null, { id: 'admin-id', email, role: 'Admin' });
      } else if (password === 'user') {
        return done(null, { id: 'user-id', email, role: 'Viewer' });
      }
      return done(null, false, { message: 'Incorrect credentials.' });
    }
  ));

  passport.serializeUser((user: any, done) => {
    done(null, JSON.stringify(user));
  });

  passport.deserializeUser((id: string, done) => {
    try {
      done(null, JSON.parse(id));
    } catch {
      done(new Error("Failed to deserialize"), null);
    }
  });
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (req.isAuthenticated && req.isAuthenticated()) {
    return next();
  }
  res.status(401).json({ error: 'Unauthorized' });
}

export function requireAdmin(req: Request, res: Response, next: NextFunction) {
  requireAuth(req, res, () => {
    const user = req.user as any;
    if (user && user.role === 'Admin') {
      return next();
    }
    res.status(403).json({ error: 'Forbidden. Admin role required.' });
  });
}
