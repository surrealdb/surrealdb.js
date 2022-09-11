import webpack from 'webpack';

export default [
	{
		target: 'web',
		entry: './index.js',
		output: {
			clean: true,
			filename: 'index.js',
			path: new URL('./dist/web', import.meta.url).pathname,
			library: {
				name: 'Surreal',
				type: 'umd',
				export: 'default',
				umdNamedDefine: true,
			},
		},
		devtool: false,
		plugins: [
			new webpack.NormalModuleReplacementPlugin(
				/..\/websocket\/index.js$/,
				'/src/websocket/index.web.js',
			)
		],
		module: {
			rules: [{
				test: /\.ts$/,
				exclude: /(node_modules)/,
				use: {
					loader: 'babel-loader',
					options: {
						presets: [
							'@babel/preset-env',
							'@babel/preset-typescript',
						],
						plugins: [
							'@babel/plugin-proposal-class-properties',
							'@babel/plugin-proposal-private-methods',
						],
					}
				}
			}]
		},
		resolve: {
			extensionAlias: {
				'.js': ['.ts', '.js'],
			}
		}
	},
	{
		target: 'node',
		entry: './index.js',
		output: {
			clean: true,
			filename: 'index.cjs',
			path: new URL('./dist/lib', import.meta.url).pathname,
			library: {
				name: 'Surreal',
				type: 'umd',
				export: 'default',
				umdNamedDefine: true,
			},
		},
		devtool: false,
		plugins: [
			new webpack.NormalModuleReplacementPlugin(
				/..\/websocket\/index.js$/,
				'/src/websocket/index.node.js',
			)
		],
		module: {
			rules: [{
				test: /\.ts$/,
				exclude: /(node_modules)/,
				use: {
					loader: 'babel-loader',
					options: {
						presets: [
							'@babel/preset-env',
							'@babel/preset-typescript',
						],
						plugins: [
							'@babel/plugin-proposal-class-properties',
							'@babel/plugin-proposal-private-methods',
						],
					}
				}
			}]
		},
		resolve: {
			extensionAlias: {
				'.js': ['.ts', '.js'],
			}
		}
	},
];
