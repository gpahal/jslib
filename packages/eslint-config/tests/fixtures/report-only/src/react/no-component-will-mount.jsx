// The rename leaves the call of `componentWillMount`, which then throws
import { Component } from 'react'

export class Base extends Component {
  componentWillMount() {
    this.ready = true
  }

  componentDidMount() {
    this.componentWillMount()
  }

  render() {
    return null
  }
}
