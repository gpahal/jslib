// The rename leaves the call of `componentWillReceiveProps`, which then throws
import { Component } from 'react'

export class Base extends Component {
  componentWillReceiveProps(props) {
    this.last = props
  }

  componentDidMount() {
    this.componentWillReceiveProps(this.props)
  }

  render() {
    return null
  }
}
