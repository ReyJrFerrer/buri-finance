import { defineTheme } from '@astryxdesign/core/theme'
import { neutralTheme } from '@astryxdesign/theme-neutral'

// Neutral with the app's blue accent and the money colours of the overview. Page backgrounds
// stay neutral's; dark values are matched to the design reference.
export const buriTheme = defineTheme({
  name: 'buri',
  extends: neutralTheme,
  tokens: {
    '--color-accent': ['#3d6fd9', '#3d6fd9'],
    '--color-on-accent': ['#ffffff', '#ffffff'],
    '--color-text-accent': ['#2f5fc4', '#9ac2ff'],
    '--color-icon-accent': ['#3d6fd9', '#9ac2ff'],
    '--color-background-card': ['#ffffff', '#1f1f23'],
    '--color-border': ['#00000014', '#2b2b30'],
    '--color-neutral': ['#0000000F', '#2a2a30'],
    '--color-background-gray': ['#ececef', '#2a2a30'],
    '--color-text-gray': ['#3f3f46', '#cfcfd5'],
    '--color-text-secondary': ['#5c5c66', '#8d8d96'],
    '--color-background-green': ['#d6f2e3', '#1c3326'],
    '--color-text-green': ['#13633b', '#97f0c1'],
    '--color-background-orange': ['#fde6d2', '#3a2a1a'],
    '--color-text-orange': ['#8a4410', '#ffcb98'],
    '--color-icon-orange': ['#c25e14', '#ffa761'],
    '--color-background-blue': ['#dde7fb', '#23283a'],
    '--color-icon-blue': ['#2f5fc4', '#8eb2fd']
  },
  localTokens: {
    '--color-chart-blue': ['#3d6fd9', '#5b8def'],
    '--color-chart-blue-fill': ['#3d6fd91f', '#5b8def1f'],
    '--color-chart-purple': ['#8b6fe8', '#c4b5fd'],
    '--color-chart-gray': ['#9a9aa3', '#6b6b74'],
    '--color-chart-track': ['#e6e6ea', '#2e2e35'],
    '--color-chart-tick': ['#1b1b1b', '#f0f0f1'],
    '--color-chart-future': ['#00000008', '#ffffff07'],
    '--color-chart-pace': ['#8d8d96', '#92929b'],
    '--color-chart-marker': ['#c27a3f', '#da9b68']
  },
  components: {
    text: {
      'color:positive': { color: 'light-dark(#13804a, #70d6a2)' },
      'color:negative': { color: 'light-dark(#b4560f, #ffb577)' },
      'color:warm': { color: 'light-dark(#7a4510, #ffe3be)' }
    },
    card: {
      'variant:warm': { backgroundColor: 'light-dark(#fdf1e4, #2a2418)' }
    },
    button: {
      'variant:warm': {
        backgroundColor: 'light-dark(#fdf1e4, #2e2418)',
        borderColor: 'light-dark(#e8c9a6, #674f36)',
        borderWidth: '1px',
        borderStyle: 'solid',
        color: 'light-dark(#7a4510, #ffd19c)'
      },
      'variant:info': {
        backgroundColor: 'light-dark(#eef3fd, #1f2638)',
        borderColor: 'light-dark(#c5d4f5, #2e364c)',
        borderWidth: '1px',
        borderStyle: 'solid',
        color: 'light-dark(#1f4aa8, #c8dcff)'
      },
      'variant:chip': {
        backgroundColor: 'light-dark(#fdf1e4, #2a2418)',
        borderColor: 'light-dark(#e8c9a6, #674f36)',
        borderWidth: '1px',
        borderStyle: 'dashed',
        borderRadius: '9999px',
        color: 'light-dark(#7a4510, #fdc190)'
      }
    }
  }
})
