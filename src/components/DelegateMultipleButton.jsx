import React, { Component } from 'react';
import { SkyLightStateless } from 'react-skylight';
import { utils } from 'web3';
import { Form, Input } from 'formsy-react-components';
import PropTypes from 'prop-types';
import { paramsForServer } from 'feathers-hooks-common';
import Slider from 'react-rangeslider';
import 'react-rangeslider/lib/index.css';
import BigNumber from 'bignumber.js';
import InputToken from 'react-input-token';

import { checkWalletBalance } from '../lib/middleware';
import { feathersClient } from '../lib/feathersClient';
import GivethWallet from '../lib/blockchain/GivethWallet';
import Loader from './Loader';

import Donation from '../models/Donation';
import Campaign from '../models/Campaign';
import User from '../models/User';

import DonationService from '../services/DonationService';

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
      isLoadingDonations: true,
      modalVisible: false,
      delegations: [],
      maxAmount: 0,
      dacs: [],
      objectToDelegateFrom: [],
    };

    this.loadDonations = this.loadDonations.bind(this);
    this.selectedObject = this.selectedObject.bind(this);
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
          this.setState({
            dacs: resp.data.map(c => ({
              name: c.title,
              id: c._id, // eslint-disable-line no-underscore-dangle
              ownerAddress: c.ownerAddress,
              delegateId: c.delegateId,
              type: 'dac',
            })),
          }),
        () => {},
      );
  }

  selectedObject({ target }) {
    this.setState({ objectToDelegateFrom: target.value, isLoadingDonations: true });
    this.loadDonations(target.value);
  }

  handlePageChanged(newPage) {
    this.setState({ skipPages: newPage - 1 }, () => this.loadDonations());
  }

  loadDonations(entity) {
    if (this.donationsObserver) this.donationsObserver.unsubscribe();

    const options = {};
    if (entity.type === 'dac') {
      options.$or = [
        { delegateId: entity.id },
        {
          ownerId: this.props.currentUser.address,
          $not: { delegateId: { $gt: '0' } },
        },
      ];
    }

    if (this.props.milestone) {
      options.ownerId = this.props.milestone.campaign._id; // eslint-disable-line
    }

    const query = paramsForServer({
      query: {
        ...options,
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
            maxAmount: amount,
            amount,
            isLoadingDonations: false,
          });
        },
        () => this.setState({ isLoadingDonations: false }),
      );
  }

  openDialog() {
    checkWalletBalance(this.props.wallet).then(() => this.setState({ modalVisible: true }));
  }

  submit(model) {
    this.setState({ isSaving: true });

    const onCreated = txLink => {
      this.resetSkylight();

      React.swal({
        title: 'Delegated!',
        content: React.swal.msg(
          <p>
            The donations have been delegated,{' '}
            <a href={`${txLink}`} target="_blank" rel="noopener noreferrer">
              view the transaction here.
            </a>
            <p>
              The donations have been delegated. Please note the the Giver may have{' '}
              <strong>3 days</strong> to reject your delegation before the money gets committed.
            </p>
          </p>,
        ),
        icon: 'success',
      });
    };

    const onSuccess = txLink => {
      React.toast.success(
        <p>
          Your donation has been confirmed!<br />
          <a href={`${txLink}`} target="_blank" rel="noopener noreferrer">
            View transaction
          </a>
        </p>,
      );
    };

    DonationService.delegateMultiple(
      this.state.delegations,
      utils.toWei(model.amount),
      this.props.campaign || this.props.milestone,
      onCreated,
      onSuccess,
    );
  }

  resetSkylight() {
    this.setState({
      isSaving: false,
    });
  }

  render() {
    const style = { display: 'inline-block', ...this.props.style };
    const { isSaving, isLoading, dacs, delegations, isLoadingDonations } = this.state;
    const { campaign, milestone } = this.props;
    const options = this.props.milestone
      ? dacs.concat([
          // eslint-disable-next-line no-underscore-dangle
          { id: milestone.campaign._id, name: milestone.campaign.title, type: 'campaign' },
        ])
      : dacs;

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
              <div className="form-group">
                <span className="label">Delegate from:</span>
                <InputToken
                  name="delegateFrom"
                  label="Delegate from:"
                  placeholder={this.props.campaign ? 'Select a DAC' : 'Select a DAC or Campaign'}
                  value={this.state.objectToDelegateFrom}
                  options={options}
                  onSelect={this.selectedObject}
                  maxLength={1}
                />
              </div>

              {this.state.objectToDelegateFrom.length !== 1 && (
                <p>
                  Please select entity from which you want to delegate money to the{' '}
                  {campaign ? campaign.title : milestone.title}{' '}
                </p>
              )}
              {this.state.objectToDelegateFrom.length === 1 &&
                isLoadingDonations && <Loader className="small btn-loader" />}
              {this.state.objectToDelegateFrom.length === 1 &&
                !isLoadingDonations &&
                delegations.length === 0 && (
                  <p>
                    There are no delegations in the DAC or Campaign you have selected that can be
                    delegated.
                  </p>
                )}
              {this.state.objectToDelegateFrom.length === 1 &&
                !isLoadingDonations &&
                delegations.length > 0 && (
                  <div>
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
                        validations={`greaterThan:0,isNumeric,lessOrEqualTo:${
                          this.state.maxAmount
                        }`}
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

                    <button
                      className="btn btn-success"
                      formNoValidate
                      type="submit"
                      disabled={isSaving}
                    >
                      {isSaving ? 'Delegating...' : 'Delegate here'}
                    </button>
                  </div>
                )}
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
