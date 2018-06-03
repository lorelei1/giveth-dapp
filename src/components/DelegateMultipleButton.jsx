import React, { Component } from 'react';
import { SkyLightStateless } from 'react-skylight';
import { utils } from 'web3';
import { Form, Input } from 'formsy-react-components';
import PropTypes from 'prop-types';
import { paramsForServer } from 'feathers-hooks-common';
import Slider from 'react-rangeslider';
import 'react-rangeslider/lib/index.css';
import BigNumber from 'bignumber.js';

import { checkWalletBalance } from '../lib/middleware';
import { feathersClient } from '../lib/feathersClient';
import GivethWallet from '../lib/blockchain/GivethWallet';
import Loader from './Loader';

import Donation from '../models/Donation';
import Campaign from '../models/Campaign';
import User from '../models/User';

BigNumber.config({ DECIMAL_PLACES: 18 });

/**
 * Retrieves the oldest 100 donations that can the user delegate
 *
 * @prop {GivethWallet} wallet      Wallet object
 * @prop {User}         currentUser Current user of the Dapp
 * @prop {Campaign}     campaign    If the delegation is towards campaign, this contains the campaign
 * @prop {Object}       milestone   It the delegation is towards campaign, this contains the milestone
 * @prop {Object}       style       Styles added to the button
 */
class DelegateMultipleButton extends Component {
  constructor(props) {
    super(props);

    this.state = {
      isSaving: false,
      modalVisible: false,
      delegations: [],
      maxAmount: 0,
    };

    this.loadDonations = this.loadDonations.bind(this);
  }

  componentDidMount() {
    this.dacsObserver = feathersClient
      .service('dacs')
      .watch({ listStrategy: 'always' })
      .find({
        query: {
          delegateId: { $gt: '0' },
          ownerAddress: this.props.currentUser.address,
          $select: ['ownerAddress', 'title', '_id', 'delegateId'],
        },
      })
      .subscribe(
        resp =>
          this.loadDonations(
            resp.data.map(c => ({
              name: c.title,
              id: c._id, // eslint-disable-line no-underscore-dangle
            })),
          ),
        () => {},
      );
  }

  handlePageChanged(newPage) {
    this.setState({ skipPages: newPage - 1 }, () => this.loadDonations());
  }

  loadDonations(dacs) {
    if (this.donationsObserver) this.donationsObserver.unsubscribe();

    const $or = [
      { delegateId: { $in: dacs.map(d => d.id) } },
      {
        ownerId: this.props.currentUser.address,
        $not: { delegateId: { $gt: '0' } },
      },
    ];

    if (this.props.milestone) {
      $or.push({ ownerId: this.props.milestone.campaign._id }); // eslint-disable-line
    }

    const query = paramsForServer({
      query: {
        $or,
        status: {
          $in: ['waiting', 'committed'],
        },
        $limit: this.state.itemsPerPage,
        $skip: this.state.skipPages * this.state.itemsPerPage,
        $sort: { createdAt: 1 },
      },
      schema: 'includeTypeAndGiverDetails',
    });

    // start watching donations, this will re-run when donations change or are added
    this.donationsObserver = feathersClient
      .service('donations')
      .watch({ listStrategy: 'always' })
      .find(query)
      .subscribe(
        r => {
          const delegations = r.data.map(d => new Donation(d));
          const amount = utils.fromWei(
            delegations
              .reduce((sum, d) => sum.plus(new BigNumber(d.amount)), new BigNumber('0'))
              .toString(),
          );
          this.setState({
            delegations,
            isLoading: false,
            maxAmount: amount,
            amount,
          });
        },
        () => this.setState({ isLoading: false }),
      );
  }

  openDialog() {
    checkWalletBalance(this.props.wallet).then(() => this.setState({ modalVisible: true }));
  }

  submit(model) {
    this.setState({ isSaving: true });
    console.log(model);
    console.log(this.state.delegations);
  }

  resetSkylight() {
    this.setState({
      isSaving: false,
    });
  }

  render() {
    const style = { display: 'inline-block', ...this.props.style };
    const { isSaving, isLoading } = this.state;
    const { campaign, milestone } = this.props;

    return (
      <span style={style}>
        <button className="btn btn-info" onClick={() => this.openDialog()}>
          Delegate
        </button>

        <SkyLightStateless
          dialogStyles={{
            width: '70%',
            height: '600px',
            marginTop: '-20%',
            marginLeft: '-35%',
            overflow: 'scroll',
          }}
          isVisible={this.state.modalVisible}
          onCloseClicked={() => this.setState({ modalVisible: false })}
          onOverlayClicked={() => this.setState({ modalVisible: false })}
          hideOnOverlayClicked
          title="Delegate Donation"
        >
          <p>
            You are delegating donations to
            {campaign && <strong> {campaign.title}</strong>}
            {milestone && <strong> {milestone.campaign.title}</strong>}
          </p>
          {isLoading && <Loader className="small btn-loader" />}
          {!isLoading && (
            <Form onSubmit={this.submit} layout="vertical">
              <span className="label">Amount to delegate:</span>

              <div className="form-group">
                <Slider
                  type="range"
                  name="amount2"
                  min={0}
                  max={Number(this.state.maxAmount)}
                  step={this.state.maxAmount / 10}
                  value={Number(this.state.amount)}
                  labels={{ 0: '0', [this.state.maxAmount]: this.state.maxAmount }}
                  format={val => `${val} ETH`}
                  onChange={amount => this.setState({ amount: Number(amount).toFixed(2) })}
                />
              </div>

              <div className="form-group">
                <Input
                  type="text"
                  validations={`greaterThan:0,isNumeric,lessOrEqualTo:${this.state.maxAmount}`}
                  validationErrors={{
                    greaterThan: 'Enter value greater than 0',
                    lessOrEqualTo: `The donation you are delegating has value of ${
                      this.state.maxAmount
                    }. Do not input higher amount.`,
                    isNumeric: 'Provide correct number',
                  }}
                  name="amount"
                  value={this.state.amount}
                  onChange={(name, amount) => this.setState({ amount })}
                />
              </div>

              <button className="btn btn-success" formNoValidate type="submit" disabled={isSaving}>
                {isSaving ? 'Delegating...' : 'Delegate here'}
              </button>
            </Form>
          )}
        </SkyLightStateless>
      </span>
    );
  }
}

DelegateMultipleButton.propTypes = {
  wallet: PropTypes.instanceOf(GivethWallet).isRequired,
  currentUser: PropTypes.instanceOf(User).isRequired,
  campaign: PropTypes.instanceOf(Campaign),
  milestone: PropTypes.shape(),
  style: PropTypes.shape(),
};

DelegateMultipleButton.defaultProps = {
  campaign: undefined,
  milestone: undefined,
  style: {},
};

export default DelegateMultipleButton;
