const path = require('path');
const nodeExternals = require('webpack-node-externals');

module.exports = {
  entry: './src/handlers/api.ts',
  target: 'node',
  mode: 'production',
  externals: [nodeExternals()],
  module: {
    rules: [
      {
        test: /\.ts$/,
        use: 'ts-loader',
        exclude: /node_modules/,
      },
    ],
  },
  resolve: {
    extensions: ['.ts', '.js'],
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
  output: {
    path: path.resolve(__dirname, '.webpack'),
    filename: 'handler.js',
    libraryTarget: 'commonjs2',
  },
  optimization: {
    minimize: false,
  },
};