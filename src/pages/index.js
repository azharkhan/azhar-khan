import React from 'react'
import Link from 'gatsby-link'

import styles from './index.module.css';

const IndexPage = () => (
  <div className={styles.container}>
    <h1 className={styles.name}>Azhar Khan</h1>
    <p className={styles.description}>Developer @ Hubba</p>
    <ul className={styles.linksContainer}>
      <Link className={styles.link}>Work</Link>
      <Link className={styles.link}>Posts</Link>
    </ul>
  </div>
)

export default IndexPage
