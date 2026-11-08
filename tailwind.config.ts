import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: '#060912',
        panel: '#0b1120',
        line: '#1c2740',
        cyan: '#35e6d0',
        violet: '#9b7bff',
        lime: '#b8f34a',
        amber: '#ffc46b',
        rose: '#ff7a9c',
      },
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif'],
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
      boxShadow: {
        glow: '0 0 0 1px rgba(53,230,208,.16), 0 18px 60px -20px rgba(53,230,208,.28)',
        card: '0 24px 70px -40px rgba(0,0,0,.9)',
      },
      keyframes: {
        float: { '0%,100%': { transform: 'translateY(0)' }, '50%': { transform: 'translateY(-10px)' } },
        pulseGlow: { '0%,100%': { opacity: '.45' }, '50%': { opacity: '1' } },
        slideUp: { from: { opacity: '0', transform: 'translateY(14px)' }, to: { opacity: '1', transform: 'translateY(0)' } },
        shimmer: { from: { backgroundPosition: '200% 0' }, to: { backgroundPosition: '-200% 0' } },
        spinSlow: { to: { transform: 'rotate(360deg)' } },
        pingSoft: { '0%': { transform: 'scale(1)', opacity: '.7' }, '100%': { transform: 'scale(2.2)', opacity: '0' } },
      },
      animation: {
        float: 'float 7s ease-in-out infinite',
        'pulse-glow': 'pulseGlow 3s ease-in-out infinite',
        'slide-up': 'slideUp .45s cubic-bezier(.2,.8,.2,1) both',
        shimmer: 'shimmer 2.2s linear infinite',
        'spin-slow': 'spinSlow 18s linear infinite',
        'ping-soft': 'pingSoft 1.8s ease-out infinite',
      },
    },
  },
  plugins: [],
};

export default config;
