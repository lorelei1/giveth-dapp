import { LPPCampaign } from 'lpp-campaign';
import { LPPDac } from 'lpp-dac';
import { utils } from 'web3';
import BigNumber from 'bignumber.js';

import getNetwork from '../lib/blockchain/getNetwork';
import { feathersClient } from '../lib/feathersClient';
import { getWeb3 } from '../lib/blockchain/getWeb3';

import ErrorPopup from '../components/ErrorPopup';
// import Campaign from '../models/Campaign';

// TODO: Remove in future
/* eslint no-underscore-dangle: 0 */
class DonationService {
  /**
   * Delegate multiple donations to some entity (either Campaign or Milestone)
   *
   * @param {Array}    donations   Array of donations that can be delegated
   * @param {string}   amount      Total ammount in wei to be delegated - needs to be between 0 and total donation amount
   * @param {Object}   delegateTo  Entity to which the donation should be delegated
   * @param {function} onCreated   Callback function after the transaction has been broadcasted to chain and stored in feathers
   * @param {function} onSuccess   Callback function after the transaction has been mined
   * @param {function} onError     Callback function after error happened
   */
  static delegateMultiple(
    donations,
    amount,
    delegateTo,
    onCreated = () => {},
    onSuccess = () => {},
    onError = () => {},
  ) {
    const { type } = donations[0];
    let txHash;
    let etherScanUrl;
    const pledgedDonations = [];

    const getPledges = () => {
      const maxAmount = new BigNumber(amount);
      let currentAmount = new BigNumber('0');
      let fullyDonated = true;

      const pledges = [];
      donations.every(donation => {
        const pledge = pledges.find(n => n.id === donation.pledgeId);

        let donatedAmount = new BigNumber(donation.amount);

        if (currentAmount.plus(donatedAmount).isGreaterThan(maxAmount)) {
          donatedAmount = maxAmount.minus(currentAmount);
          fullyDonated = false;

          // This donation would have value of 0, stop the iteration before it is added
          if (donatedAmount.isEqualTo(new BigNumber('0'))) return fullyDonated;
        }
        pledgedDonations.push({ donation, fullyDonated });

        currentAmount = currentAmount.plus(donatedAmount);
        if (pledge) {
          pledge.amount = pledge.amount.plus(donatedAmount);
        } else {
          pledges.push({
            id: donation.pledgeId,
            amount: donatedAmount,
          });
        }
        return fullyDonated;
      });

      return pledges.map(
        note =>
          // due to some issue in web3, utils.toHex(note.amount) breaks during minification.
          // BN.toString(16) will return a hex string as well
          `0x${utils.padLeft(note.amount.toString(16), 48)}${utils.padLeft(
            utils.toHex(note.id).substring(2),
            16,
          )}`,
      );
    };

    Promise.all([getNetwork(), getWeb3(), getPledges()])
      .then(([network, web3, pledges]) => {
        etherScanUrl = network.etherscan;

        const from =
          type === 'dac'
            ? donations[0].delegateEntity.ownerAddress
            : donations[0].ownerEntity.ownerAddress;
        // const senderId = type === 'dac' ? donations[0].delegate : donations[0].owner;
        const receiverId = delegateTo.projectId;

        const executeTransfer = () => {
          let contract;

          if (donations[0].type === 'dac') {
            contract = new LPPCampaign(web3, donations[0].ownerEntity.pluginAddress);
          } else {
            contract = new LPPDac(web3, donations[0].delegateEntity.pluginAddress);
          }

          return contract.mTransfer(pledges, receiverId, {
            from,
            $extraGas: 100000,
          });
        };

        return executeTransfer()
          .once('transactionHash', hash => {
            txHash = hash;
            const mutation = {
              txHash,
              status: 'pending',
            };

            pledgedDonations.forEach(d => {
              if (d.fullyDonated) {
                if (d.donation.ownerType.toLowerCase() === 'campaign') {
                  // campaign is the owner, so they transfer the donation, not propose
                  Object.assign(mutation, {
                    owner: delegateTo.projectId,
                    ownerId: delegateTo.id || delegateTo._id,
                    ownerType: delegateTo.type,
                  });
                } else {
                  // dac proposes a delegation
                  Object.assign(mutation, {
                    intendedProject: delegateTo.projectId,
                    intendedProjectId: delegateTo.id || delegateTo._id,
                    intendedProjectType: delegateTo.type,
                  });
                }
              }

              feathersClient
                .service('/donations')
                .patch(d.donation.id, mutation)
                .then(() => onCreated(`${etherScanUrl}tx/${txHash}`))
                .catch(err => {
                  ErrorPopup('Unable to update the donation in feathers', err);
                  onError(err);
                });
            });
          })
          .catch(err => {
            if (txHash && err.message && err.message.includes('unknown transaction')) return; // bug in web3 seems to constantly fail due to this error, but the tx is correct
            ErrorPopup(
              'Thare was a problem with the delegation transaction.',
              `${etherScanUrl}tx/${txHash}`,
            );
            onError(err);
          });
      })
      .then(() => onSuccess(`${etherScanUrl}tx/${txHash}`))
      .catch(err => {
        ErrorPopup('Unable to initiate the delegation transaction.', err);
        onError(err);
      });
  }

  /**
   * Delegate the donation to some entity (either Campaign or Milestone)
   *
   * @param {Donation} donation    Donation to be delegated
   * @param {string}   amount      Ammount of the donation that is to be delegated - needs to be between 0 and donation amount
   * @param {Object}   delegateTo  Entity to which the donation should be delegated
   * @param {function} onCreated   Callback function after the transaction has been broadcasted to chain and stored in feathers
   * @param {function} onSuccess   Callback function after the transaction has been mined
   * @param {function} onError     Callback function after error happened
   */
  static delegate(
    donation,
    amount,
    delegateTo,
    onCreated = () => {},
    onSuccess = () => {},
    onError = () => {},
  ) {
    let txHash;
    let etherScanUrl;
    Promise.all([getNetwork(), getWeb3()])
      .then(([network, web3]) => {
        etherScanUrl = network.etherscan;

        const from =
          donation.delegate > 0
            ? donation.delegateEntity.ownerAddress
            : donation.ownerEntity.ownerAddress;
        const senderId = donation.delegate > 0 ? donation.delegate : donation.owner;
        const receiverId = delegateTo.type === 'dac' ? delegateTo.delegateId : delegateTo.projectId;

        const executeTransfer = () => {
          let contract;

          if (donation.ownerType === 'campaign') {
            contract = new LPPCampaign(web3, donation.ownerEntity.pluginAddress);
          } else if (donation.ownerType === 'giver' && donation.delegate > 0) {
            contract = new LPPDac(web3, donation.delegateEntity.pluginAddress);
          }

          if (contract) {
            return contract.transfer(donation.pledgeId, amount, receiverId, {
              from,
              $extraGas: 100000,
            });
          }

          return network.liquidPledging.transfer(senderId, donation.pledgeId, amount, receiverId, {
            from,
            $extraGas: 100000,
          }); // need to supply extraGas b/c https://github.com/trufflesuite/ganache-core/issues/26
        };

        return executeTransfer()
          .once('transactionHash', hash => {
            txHash = hash;
            const mutation = {
              txHash,
              status: 'pending',
            };

            if (amount === donation.amount) {
              if (donation.ownerType.toLowerCase() === 'campaign') {
                // campaign is the owner, so they transfer the donation, not propose
                Object.assign(mutation, {
                  owner: delegateTo.projectId,
                  ownerId: delegateTo._id,
                  ownerType: delegateTo.type,
                });
              } else {
                // dac proposes a delegation
                Object.assign(mutation, {
                  intendedProject: delegateTo.projectId,
                  intendedProjectId: delegateTo._id,
                  intendedProjectType: delegateTo.type,
                });
              }
            }

            feathersClient
              .service('/donations')
              .patch(donation.id, mutation)
              .then(() => onCreated(`${etherScanUrl}tx/${txHash}`))
              .catch(err => {
                ErrorPopup('Unable to update the donation in feathers', err);
                onError(err);
              });
          })
          .catch(err => {
            if (txHash && err.message && err.message.includes('unknown transaction')) return; // bug in web3 seems to constantly fail due to this error, but the tx is correct
            ErrorPopup(
              'Thare was a problem with the delegation transaction.',
              `${etherScanUrl}tx/${txHash}`,
            );
            onError(err);
          });
      })
      .then(() => onSuccess(`${etherScanUrl}tx/${txHash}`))
      .catch(err => {
        ErrorPopup('Unable to initiate the delegation transaction.', err);
        onError(err);
      });
  }

  /**
   * Reject the delegation of the donation
   *
   * @param {Donation} donation  Donation which delegation should be rejected
   * @param {string}   address   Address of the user who calls reject
   * @param {function} onCreated Callback function after the transaction has been broadcasted to chain and stored in feathers
   * @param {function} onSuccess Callback function after the transaction has been mined
   * @param {function} onError   Callback function after error happened
   */
  static reject(donation, address, onCreated = () => {}, onSuccess = () => {}, onError = () => {}) {
    let txHash;
    let etherScanUrl;
    getNetwork()
      .then(network => {
        etherScanUrl = network.etherscan;

        return network.liquidPledging
          .transfer(donation.owner, donation.pledgeId, donation.amount, donation.delegate, {
            $extraGas: 50000,
            from: address,
          })
          .once('transactionHash', hash => {
            txHash = hash;

            feathersClient
              .service('/donations')
              .patch(donation.id, {
                status: 'pending',
                $unset: {
                  pendingProject: true,
                  pendingProjectId: true,
                  pendingProjectType: true,
                },
                txHash,
              })
              .then(() => {
                onCreated(`${etherScanUrl}tx/${txHash}`);
              })
              .catch(err => {
                ErrorPopup('Something went wrong while comitting your donation.', err);
                onError(err);
              });
          });
      })
      .then(() => {
        onSuccess(`${etherScanUrl}tx/${txHash}`);
      })
      .catch(err => {
        if (txHash && err.message && err.message.includes('unknown transaction')) return; // bug in web3 seems to constantly fail due to this error, but the tx is correct
        ErrorPopup(
          'Something went wrong with the transaction. Is your wallet unlocked?',
          `${etherScanUrl}tx/${txHash}`,
        );
        onError(err);
      });
  }

  /**
   * Commit donation that has been delegated
   *
   * @param {Donation} donation  Donation to be committed
   * @param {string}   address   Address of the user who calls commit
   * @param {function} onCreated Callback function after the transaction has been broadcasted to chain and stored in feathers
   * @param {function} onSuccess Callback function after the transaction has been mined
   * @param {function} onError   Callback function after error happened
   */
  static commit(donation, address, onCreated = () => {}, onSuccess = () => {}, onError = () => {}) {
    let txHash;
    let etherScanUrl;
    getNetwork()
      .then(network => {
        etherScanUrl = network.etherscan;

        return network.liquidPledging
          .transfer(donation.owner, donation.pledgeId, donation.amount, donation.intendedProject, {
            $extraGas: 50000,
            from: address,
          })
          .once('transactionHash', hash => {
            txHash = hash;

            feathersClient
              .service('/donations')
              .patch(donation.id, {
                status: 'pending',
                $unset: {
                  pendingProject: true,
                  pendingProjectId: true,
                  pendingProjectType: true,
                  delegate: true,
                  delegateType: true,
                  delegateId: true,
                },
                txHash,
                owner: donation.pendingProject,
                ownerId: donation.pendingProjectId,
                ownerType: donation.pendingProjectType,
              })
              .then(() => {
                onCreated(`${etherScanUrl}tx/${txHash}`);
              })
              .catch(err => {
                ErrorPopup('Something went wrong while comitting your donation.', err);
                onError(err);
              });
          });
      })
      .then(() => {
        onSuccess(`${etherScanUrl}tx/${txHash}`);
      })
      .catch(err => {
        if (txHash && err.message && err.message.includes('unknown transaction')) return; // bug in web3 seems to constantly fail due to this error, but the tx is correct
        ErrorPopup(
          'Something went wrong with the transaction. Is your wallet unlocked?',
          `${etherScanUrl}tx/${txHash}`,
        );
        onError(err);
      });
  }

  /**
   * Refund a donation
   *
   * @param {Donation} donation  Donation to be refunded
   * @param {string}   address   Address of the user who calls refund
   * @param {function} onCreated Callback function after the transaction has been broadcasted to chain and stored in feathers
   * @param {function} onSuccess Callback function after the transaction has been mined
   * @param {function} onError   Callback function after error happened
   */
  static refund(donation, address, onCreated = () => {}, onSuccess = () => {}, onError = () => {}) {
    let txHash;
    let etherScanUrl;

    getNetwork()
      .then(network => {
        etherScanUrl = network.etherscan;

        return network.liquidPledging
          .withdraw(donation.pledgeId, donation.amount, {
            $extraGas: 50000,
            from: address,
          })
          .once('transactionHash', hash => {
            txHash = hash;
            feathersClient
              .service('/donations')
              .patch(donation.id, {
                status: 'pending',
                $unset: {
                  delegate: true,
                  delegateId: true,
                  delegateType: true,
                  pendingProject: true,
                  pendingProjectId: true,
                  pendingProjectType: true,
                },
                paymentStatus: 'Paying',
                txHash,
              })
              .then(() => onCreated(`${etherScanUrl}tx/${txHash}`))
              .catch(err => {
                ErrorPopup('Something went wrong while revoking your donation.', err);
                onError(err);
              });
          });
      })
      .then(() => onSuccess(`${etherScanUrl}tx/${txHash}`))
      .catch(err => {
        if (txHash && err.message && err.message.includes('unknown transaction')) return; // bug in web3 seems to constantly fail due to this error, but the tx is correct
        ErrorPopup(
          'Something went wrong with the transaction. Is your wallet unlocked?',
          `${etherScanUrl}tx/${txHash}`,
        );
        onError(err);
      });
  }
}

export default DonationService;
