import './globals.css';

export const metadata = {
  title: 'Eldorado Operations',
  description: 'Secure coin-order operations and reconciliation platform'
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
