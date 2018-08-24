module.exports = {
  siteMetadata: {
    title: 'Azhar Khan',
  },
  plugins: ['gatsby-plugin-react-helmet',
    {
      resolve: 'gatsby-plugin-google-fonts',
      options: {
          fonts: [
              'Raleway:400,900',
              'Montserrat'
          ]
      }
    }
  ],
};
