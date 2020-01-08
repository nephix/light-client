const path = require('path');

module.exports = {
  entry: './src/index.ts',
  target: 'node',
  mode: 'production',
  // devtool: 'inline-source-map',
  devtool: 'cheap-source-map',
  output: {
    path: path.resolve(__dirname, 'build'),
    filename: 'bundle.js',
  },
  stats: {
    // Ignore warnings due to yarg's dynamic module loading
    warningsFilter: [/node_modules\/yargs/],
  },
  watchOptions: {
    ignored: ['node_modules'],
  },
  resolve: {
    extensions: ['.ts', '.js'], //resolve all the modules other than index.ts
    alias: {
      ethers: path.resolve('../raiden-ts/node_modules/ethers'),
      lodash: path.resolve('../raiden-ts/node_modules/lodash'),
    },
  },
  module: {
    rules: [
      {
        use: 'ts-loader',
        test: /\.ts$/,
      },
    ],
  },
};
