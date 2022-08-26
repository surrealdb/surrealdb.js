import * as path from 'path';

export default [
	{
		target: "web",
		entry: "./src/index.ts",
		output: {
			path: path.resolve(process.cwd(), "dist"),
			filename: "main.browser.js",
			libraryExport: "default",
			libraryTarget: "window",
			library: "Surreal",
			clean: true,
		},
		resolve: {
			extensions: [".ts", ".js"],
		},
		module: {
			rules: [
				{
					test: /\.tsx?/,
					use: "ts-loader",
					exclude: /node_modules/,
				},
			],
		},
	},
	{
		target: "node",
		entry: "./src/index.ts",
		output: {
			path: path.resolve(process.cwd(), "dist"),
			filename: "main.node.js",
			libraryExport: "default",
			libraryTarget: "umd",
			library: "Surreal",
		},
		resolve: {
			extensions: [".ts", ".js"],
		},
		module: {
			rules: [
				{
					test: /\.tsx?/,
					use: "ts-loader",
					exclude: /node_modules/,
				},
			],
		},
	},
];
