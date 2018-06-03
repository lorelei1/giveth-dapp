import React, { Component } from 'react';
import { SkyLightStateless } from 'react-skylight';
import { utils } from 'web3';
import { Form, Input } from 'formsy-react-components';
import PropTypes from 'prop-types';
import 'react-rangeslider/lib/index.css';
import { paramsForServer } from 'feathers-hooks-common';
import Pagination from 'react-js-pagination';

import { checkWalletBalance } from '../lib/middleware';
import { feathersClient } from '../lib/feathersClient';
import GivethWallet from '../lib/blockchain/GivethWallet';
import Loader from './Loader';

import Donation from '../models/Donation';
import Campaign from '../models/Campaign';
import User from '../models/User';

// import DonationService from '../services/DonationService';

class DelegateMultipleButton extends Component {
  constructor(props) {
    super(props);

    this.state = {
      isSaving: false,
      modalVisible: false,
      delegations: [],
      visiblePages: 10,
      itemsPerPage: 100,
      skipPages: 0,
      totalResults: 0,
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
      .subscribe(this.loadDonations, () => {});
  }

  handlePageChanged(newPage) {
    this.setState({ skipPages: newPage - 1 }, () => this.loadDonations());
  }

  loadDonations(resp) {
    if (this.donationsObserver) this.donationsObserver.unsubscribe();

    const dacs = resp
      ? resp.data.map(c => ({
          name: c.title,
          id: c._id, // eslint-disable-line no-underscore-dangle
        }))
      : this.state.dacs;

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
          this.setState({
            dacs,
            delegations: r.data.map(d => new Donation(d)),
            isLoading: false,
            itemsPerPage: resp.limit,
            skipPages: resp.skip,
            totalResults: resp.total,
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
  }

  resetSkylight() {
    this.setState({
      isSaving: false,
    });
  }

  render() {
    const style = { display: 'inline-block', ...this.props.style };
    const {
      skipPages,
      itemsPerPage,
      totalResults,
      visiblePages,
      delegations,
      isSaving,
      isLoading,
    } = this.state;
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
          <Form onSubmit={this.submit} layout="vertical">
            <div style={{ overflow: 'scroll', height: '400px' }}>
              <span className="label">Please select donations to be delegated:</span>

              {isLoading && <Loader className="fixed" />}
              {!isLoading && (
                <table className="table table-responsive table-striped table-hover">
                  <thead>
                    <tr>
                      <td>Owner Entity</td>
                      <td>Amount</td>
                      <td>To Donate</td>
                    </tr>
                  </thead>
                  <tbody>
                    {delegations.map(del => (
                      <tr key={del.id}>
                        <td>
                          {del.donatedTo.type === 'DAC'
                            ? del.delegateEntity.title
                            : del.ownerEntity.title}
                        </td>
                        <td>{utils.fromWei(del.amount)}</td>
                        <td>
                          <Input name="amount[]" />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}

              <center>
                <Pagination
                  activePage={skipPages + 1}
                  itemsCountPerPage={itemsPerPage}
                  totalItemsCount={totalResults}
                  pageRangeDisplayed={visiblePages}
                  onChange={this.handlePageChanged}
                />
              </center>
            </div>

            <button className="btn btn-success" formNoValidate type="submit" disabled={isSaving}>
              {isSaving ? 'Delegating...' : 'Delegate here'}
            </button>
          </Form>
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
