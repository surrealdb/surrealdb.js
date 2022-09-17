import replace from '@rollup/plugin-replace'
import { defineConfig } from 'rollup'
import rename from 'rollup-plugin-rename'
import typescript from 'rollup-plugin-ts'

export default defineConfig({
  input: './src/index.ts',
  plugins: [
    replace({
      values: { '.ts': '.js' },
      preventAssignment: true,
    }),
    // fixes bundled tslib becoming cjs because it's inside a node_modules dir
    rename({ map: name => name.replace(/node_modules/, 'external') }),
    typescript(),
  ],
  external: [
    'isomorphic-ws',
  ],
  output: [
    {
      dir: 'dist/esm',
      preserveModules: true,
      preserveModulesRoot: 'src',
    },
    {
      dir: 'dist/cjs',
      format: 'cjs',
      exports: 'named',
      interop: 'esModule',
      preserveModules: true,
      preserveModulesRoot: 'src',
      plugins: [
        // allows cjs users to import cjs files inside our esm package
        rename({ map: name => name.replace(/\.js$/, '.cjs') }),
      ],
    },
  ],
})
