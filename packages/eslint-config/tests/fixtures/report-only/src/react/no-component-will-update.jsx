// The rename leaves the call of `componentWillUpdate`, which then throws
import { Component } from 'react'

export class Base extends Component {
  componentWillUpdate() {
    this.updating = true
  }

  componentDidMount() {
    this.componentWillUpdate()
  }

  render() {
    return null
  }
}
